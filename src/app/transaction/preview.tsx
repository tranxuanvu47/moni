import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/src/components/ui/Button';
import { AppText } from '@/src/components/ui/AppText';
import { StackHeader } from '@/src/components/ui/Header';
import { CategoryPicker } from '@/src/components/ui/Pickers';
import { getDatabase } from '@/src/database/expo-client';
import { listCategories } from '@/src/database/repositories/categories';
import { matchCategorizationRule, upsertCategorizationRule } from '@/src/database/repositories/categorization-rules';
import { addAttachment, createTransaction } from '@/src/database/repositories/transactions';
import { parseExpenseInput } from '@/src/features/ai/parse-pipeline';
import { describeAiError } from '@/src/services/ai/errors';
import { getAiRuntimeConfig, parseExpenseWithAi } from '@/src/services/ai/shopaikey';
import { reviewBudgetAlert } from '@/src/services/notifications/reminders';
import { useDataStore, useDraftStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Category } from '@/src/types/finance';
import { combineDateAndTime, formatIsoDate } from '@/src/utils/dates';
import { findAmount, formatVnd } from '@/src/utils/money';

export default function PreviewScreen() {
  const drafts = useDraftStore((state) => state.drafts);
  const notice = useDraftStore((state) => state.notice);
  const sourceText = useDraftStore((state) => state.sourceText);
  const updateDraft = useDraftStore((state) => state.updateDraft);
  const removeDraft = useDraftStore((state) => state.removeDraft);
  const setResult = useDraftStore((state) => state.setResult);
  const clear = useDraftStore((state) => state.clear);
  const bump = useDataStore((state) => state.bump);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [amountText, setAmountText] = useState<Record<string, string>>({});
  const [learnDrafts, setLearnDrafts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    listCategories(getDatabase()).then(setCategories).catch(() => undefined);
  }, []);

  const blocked = drafts.length === 0 || drafts.some((draft) => draft.amount == null || draft.amount <= 0 || !draft.categoryId);

  async function saveAll() {
    if (blocked || busy) {
      return;
    }
    setBusy(true);
    try {
      const db = getDatabase();
      await db.transaction(async () => {
        for (const draft of drafts) {
          if (draft.amount == null || !draft.categoryId) {
            throw new Error('Còn khoản chưa đủ số tiền hoặc hạng mục.');
          }
          const created = await createTransaction(db, {
            type: draft.type,
            amount: draft.amount,
            categoryId: draft.categoryId,
            description: draft.description,
            occurredAt: combineDateAndTime(draft.date, new Date()),
          });
          if (learnDrafts[draft.id] && draft.description.trim()) {
            await upsertCategorizationRule(db, {
              matchKind: 'user_defined',
              pattern: draft.description,
              categoryId: draft.categoryId,
            });
          }
          if (draft.attachmentUri) {
            await addAttachment(db, { transactionId: created.id, localUri: draft.attachmentUri, mimeType: 'image/jpeg' });
          }
        }
      });
      await reviewBudgetAlert().catch(() => undefined);
      bump();
      clear();
      router.dismissAll();
    } catch (error) {
      Alert.alert('Chưa lưu', error instanceof Error ? error.message : 'Không lưu được giao dịch.');
    } finally {
      setBusy(false);
    }
  }

  async function askAi() {
    const config = await getAiRuntimeConfig();
    if (!config) {
      Alert.alert('Trợ lý AI', 'Hãy thêm khóa AI trong Cài đặt → Trợ lý AI.');
      return;
    }
    setBusy(true);
    try {
      const result = await parseExpenseInput(sourceText, {
        now: new Date(),
        categories,
        allowAi: true,
        forceAi: true,
        ai: { parseExpenseText: parseExpenseWithAi },
        matchCategoryRule: (input) => matchCategorizationRule(getDatabase(), input),
        describeError: describeAiError,
      });
      setResult(result.drafts, result.notice ?? null, result.source, sourceText);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Kiểm tra giao dịch" />
      <ScrollView contentContainerStyle={styles.content}>
        {notice ? <AppText color={colors.textSecondary}>{notice}</AppText> : null}
        {drafts.map((draft) => (
          <View key={draft.id} style={styles.draft}>
            <TextInput
              value={draft.description}
              onChangeText={(description) => updateDraft(draft.id, { description })}
              style={styles.input}
            />
            <TextInput
              value={amountText[draft.id] ?? (draft.amount == null ? '' : String(draft.amount))}
              onChangeText={(value) => {
                setAmountText((current) => ({ ...current, [draft.id]: value }));
                const parsed = findAmount(value);
                const amount = parsed && !parsed.ambiguous ? parsed.amount : null;
                updateDraft(draft.id, {
                  amount,
                  needsReview: amount == null,
                  reviewReason: amount == null ? 'Hãy nhập số tiền, ví dụ 35k hoặc 35000.' : undefined,
                });
              }}
              placeholder="Số tiền, ví dụ 35k"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              keyboardType="default"
            />
            <AppText variant="caption" color={colors.textSecondary}>
              {draft.amount ? formatVnd(draft.amount) : 'Chưa có số tiền'} · {draft.date.split('-').reverse().join('/')}
            </AppText>
            {draft.reviewReason ? <AppText color={colors.expense}>{draft.reviewReason}</AppText> : null}
            <CategoryPicker
              categories={categories}
              type={draft.type}
              selectedId={draft.categoryId}
              onSelect={(category) => {
                updateDraft(draft.id, { categoryId: category.id, categoryName: category.name, categoryUncertain: false, type: category.type === 'income' ? 'income' : draft.type });
                setLearnDrafts((current) => ({ ...current, [draft.id]: true }));
              }}
            />
            {learnDrafts[draft.id] ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: true }} onPress={() => setLearnDrafts((current) => ({ ...current, [draft.id]: false }))}>
                <AppText variant="caption" color={colors.incomeText}>✓ Ghi nhớ mô tả này cho lần sau</AppText>
              </Pressable>
            ) : null}
            <View style={styles.dateActions}>
              <Pressable onPress={() => shiftDate(draft.id, draft.date, -1, updateDraft)}>
                <AppText color={colors.primary}>Hôm trước</AppText>
              </Pressable>
              <Pressable onPress={() => shiftDate(draft.id, draft.date, 1, updateDraft)}>
                <AppText color={colors.primary}>Hôm sau</AppText>
              </Pressable>
              <Pressable onPress={() => removeDraft(draft.id)}>
                <AppText color={colors.expense}>Bỏ khoản này</AppText>
              </Pressable>
            </View>
          </View>
        ))}
        <Button label="Nhờ AI đọc lại" variant="secondary" onPress={() => void askAi()} loading={busy} />
        <Button label="Lưu tất cả" onPress={() => void saveAll()} disabled={blocked} loading={busy} />
      </ScrollView>
    </View>
  );
}

function shiftDate(id: string, date: string, days: number, update: (id: string, patch: { date: string }) => void) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + days);
  update(id, { date: formatIsoDate({ year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() }) });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  draft: {
    gap: 8,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    color: colors.text,
  },
  dateActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
