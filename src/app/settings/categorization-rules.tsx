import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { CategoryPicker, SegmentedControl } from '@/src/components/ui/Pickers';
import { getDatabase } from '@/src/database/expo-client';
import { deleteCategorizationRule, listCategorizationRules, upsertCategorizationRule } from '@/src/database/repositories/categorization-rules';
import { listCategories } from '@/src/database/repositories/categories';
import { colors, radius } from '@/src/theme/tokens';
import type { CategorizationMatchKind, CategorizationRule, Category } from '@/src/types/finance';

export default function CategorizationRulesScreen() {
  const insets = useSafeAreaInsets();
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState('');
  const [kind, setKind] = useState<CategorizationMatchKind>('exact_merchant');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextRules, nextCategories] = await Promise.all([listCategorizationRules(getDatabase(), { includeDisabled: true }), listCategories(getDatabase())]);
    setRules(nextRules);
    setCategories(nextCategories);
    setCategoryId((current) => current ?? nextCategories.find((item) => item.id === 'cat_food')?.id ?? nextCategories[0]?.id ?? null);
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function save() {
    if (!pattern.trim() || !categoryId) return;
    try {
      await upsertCategorizationRule(getDatabase(), { matchKind: kind, pattern, categoryId });
      setPattern('');
      setOpen(false);
      await load();
    } catch (error) {
      Alert.alert('Quy tắc phân loại', error instanceof Error ? error.message : 'Không lưu được quy tắc.');
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Quy tắc phân loại" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText color={colors.textMuted}>Quy tắc trên máy được áp dụng trước AI, giúp phân loại nhanh hơn và gửi ít dữ liệu hơn.</AppText>
        <Button label="Thêm quy tắc" onPress={() => setOpen(true)} />
        {rules.length === 0 ? <AppText color={colors.textMuted}>Chưa có quy tắc đã học.</AppText> : null}
        {rules.map((rule) => {
          const category = categories.find((item) => item.id === rule.categoryId);
          return (
            <View key={rule.id} style={styles.row}>
              <View style={styles.copy}>
                <AppText variant="bodyMedium">{rule.pattern}</AppText>
                <AppText variant="caption" color={colors.textMuted}>{kindLabel(rule.matchKind)} → {category?.name ?? 'Hạng mục đã xóa'}</AppText>
              </View>
              <Pressable accessibilityRole="button" onPress={() => void deleteCategorizationRule(getDatabase(), rule.id).then(load)}><AppText variant="caption" color={colors.expenseText}>Xóa</AppText></Pressable>
            </View>
          );
        })}
      </ScrollView>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.dismiss} onPress={() => setOpen(false)} accessibilityLabel="Đóng" />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 20 }]}>
            <AppText variant="heading">Quy tắc mới</AppText>
            <SegmentedControl value={kind} onChange={setKind} options={[{ value: 'exact_merchant', label: 'Đúng người bán' }, { value: 'keyword', label: 'Từ khóa' }, { value: 'user_defined', label: 'Cá nhân' }]} />
            <TextInput value={pattern} onChangeText={setPattern} autoFocus placeholder="Ví dụ: HIGHLANDS" placeholderTextColor={colors.textMuted} style={styles.input} />
            <AppText variant="label" color={colors.textMuted}>Gán vào hạng mục</AppText>
            <CategoryPicker categories={categories} type="expense" selectedId={categoryId} onSelect={(item) => setCategoryId(item.id)} />
            <Button label="Lưu quy tắc" disabled={!pattern.trim() || !categoryId} onPress={() => void save()} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function kindLabel(kind: CategorizationMatchKind) { return kind === 'exact_merchant' ? 'Người bán' : kind === 'keyword' ? 'Từ khóa' : 'Quy tắc cá nhân'; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  copy: { flex: 1, gap: 2 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, gap: 14 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md, paddingHorizontal: 12, color: colors.text, fontFamily: 'Inter_400Regular' },
});
