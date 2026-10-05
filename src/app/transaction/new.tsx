import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { AppIcon } from '@/src/components/ui/Icon';
import { NumericKeypad } from '@/src/components/ui/NumericKeypad';
import { CategoryPicker, SegmentedControl, TRANSACTION_TYPE_OPTIONS } from '@/src/components/ui/Pickers';
import { getDatabase } from '@/src/database/expo-client';
import { listAccounts } from '@/src/database/repositories/accounts';
import { matchCategorizationRule } from '@/src/database/repositories/categorization-rules';
import { listCategories } from '@/src/database/repositories/categories';
import { getPreference, setPreference } from '@/src/database/repositories/preferences';
import { addAttachment, createTransaction } from '@/src/database/repositories/transactions';
import { parseExpenseInput } from '@/src/features/ai/parse-pipeline';
import { describeAiError, permissionDeniedMessage } from '@/src/services/ai/errors';
import { getAiRuntimeConfig, parseExpenseWithAi, transcribeAudio } from '@/src/services/ai/shopaikey';
import { deleteImage, persistImage } from '@/src/services/images/attachments';
import { reviewBudgetAlert } from '@/src/services/notifications/reminders';
import { useDataStore, useDraftStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Account, Category, TransactionType } from '@/src/types/finance';
import { combineDateAndTime, formatIsoDate, localDateFromDate } from '@/src/utils/dates';

export default function NewTransactionScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 250);
  const bump = useDataStore((state) => state.bump);
  const setResult = useDraftStore((state) => state.setResult);
  const pendingAttachmentUri = useDraftStore((state) => state.pendingAttachmentUri);
  const setPendingAttachmentUri = useDraftStore((state) => state.setPendingAttachmentUri);

  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null);
  const [transferFee, setTransferFee] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [showDate, setShowDate] = useState(false);
  const [attachmentUri, setAttachmentUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const savingRef = useRef(false);
  const committedRef = useRef(false);
  const attachmentRef = useRef<string | null>(null);
  const wasRecording = useRef(false);
  const handledUri = useRef<string | null>(null);
  const ignoreStop = useRef(false);
  const finishVoiceRef = useRef(finishVoice);

  useEffect(() => {
    attachmentRef.current = attachmentUri;
  }, [attachmentUri]);

  useEffect(() => {
    finishVoiceRef.current = finishVoice;
  });

  useFocusEffect(
    useCallback(() => {
      const db = getDatabase();
      Promise.all([listCategories(db), listAccounts(db), getPreference(db, 'last_transaction_account')])
        .then(([rows, accountRows, lastAccount]) => {
          const activeAccounts = accountRows as Account[];
          setCategories(rows);
          setAccounts(activeAccounts);
          setCategoryId((current) => current ?? defaultCategory(rows, 'expense'));
          setAccountId((current) => current ?? activeAccounts.find((account) => account.id === lastAccount)?.id ?? activeAccounts[0]?.id ?? null);
          setTransferAccountId((current) => current ?? activeAccounts.find((account) => account.id !== lastAccount)?.id ?? activeAccounts[1]?.id ?? null);
        })
        .catch(() => undefined);
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (!pendingAttachmentUri) {
        return;
      }
      setAttachmentUri((current) => {
        if (current) {
          deleteImage(current);
        }
        return pendingAttachmentUri;
      });
      setPendingAttachmentUri(null);
    }, [pendingAttachmentUri, setPendingAttachmentUri]),
  );

  useEffect(() => {
    return () => {
      const current = attachmentRef.current;
      if (!committedRef.current && current) {
        deleteImage(current);
      }
    };
  }, []);

  useEffect(() => {
    if (wasRecording.current && !recording.isRecording) {
      wasRecording.current = false;
      if (ignoreStop.current) {
        ignoreStop.current = false;
        return;
      }
      const uri = recorder.uri;
      if (uri && handledUri.current !== uri) {
        handledUri.current = uri;
        void finishVoiceRef.current(uri, recording.durationMillis >= 59_000);
      }
      return;
    }
    wasRecording.current = recording.isRecording;
  }, [recording.durationMillis, recording.isRecording, recorder.uri]);

  async function finishVoice(uri: string, capped: boolean) {
    const config = await getAiRuntimeConfig();
    if (!config) {
      setMessage('Chuyển giọng nói thành chữ cần mạng và khóa AI đã lưu trong Cài đặt.');
      return;
    }
    setBusy(true);
    setMessage(capped ? 'Đã dừng vì bản ghi dài hơn 60 giây. Đang phân tích…' : 'Đang phân tích…');
    try {
      const transcript = await transcribeAudio(uri);
      setDraftText(transcript);
      const ok = await analyze(transcript);
      if (!ok) {
        setMessage('Chưa tách được giao dịch. Hãy nói rõ số tiền, ví dụ cà phê 25k.');
        setTextOpen(true);
      }
    } catch (error) {
      setMessage(describeAiError(error));
    } finally {
      setBusy(false);
    }
  }

  async function analyze(source: string) {
    const trimmed = source.trim();
    if (!trimmed) {
      setMessage('Hãy nhập một khoản chi trước.');
      return false;
    }
    setBusy(true);
    setMessage(null);
    try {
      const config = await getAiRuntimeConfig();
      const result = await parseExpenseInput(trimmed, {
        now: new Date(),
        categories,
        allowAi: true,
        forceAi: false,
        ai: config ? { parseExpenseText: parseExpenseWithAi } : null,
        matchCategoryRule: (input) => matchCategorizationRule(getDatabase(), input),
        describeError: describeAiError,
      });
      if (result.drafts.length === 0) {
        setMessage('Chưa tách được giao dịch. Hãy viết rõ số tiền, ví dụ cà phê 25k.');
        return false;
      }
      const photo = attachmentRef.current;
      setResult(
        result.drafts.map((draft, index) => (index === 0 && photo ? { ...draft, attachmentUri: photo } : draft)),
        result.notice ?? 'AI đã tách và chọn hạng mục. Hãy kiểm tra trước khi lưu.',
        result.source,
        trimmed,
      );
      if (photo) {
        committedRef.current = true;
        setAttachmentUri(null);
      }
      setTextOpen(false);
      setVoiceOpen(false);
      router.push('/transaction/preview');
      return true;
    } catch (error) {
      setMessage(describeAiError(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (recording.isRecording) {
      await recorder.stop();
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Cần quyền micro', 'Hãy cho phép micro để ghi chi tiêu bằng giọng nói.', [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Mở cài đặt', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    setMessage(null);
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: 60 });
  }

  async function chooseGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Thư viện ảnh', permissionDeniedMessage('photos'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) {
      return;
    }
    await rememberImage(result.assets[0].uri);
  }

  async function rememberImage(uri: string) {
    try {
      const stored = await persistImage(uri);
      setAttachmentUri((current) => {
        if (current) {
          deleteImage(current);
        }
        return stored;
      });
    } catch {
      Alert.alert('Ảnh', 'Không lưu được ảnh. Hãy thử lại.');
    }
  }

  function removeImage() {
    if (attachmentUri) {
      deleteImage(attachmentUri);
    }
    setAttachmentUri(null);
  }

  async function saveManual() {
    const isTransfer = type === 'transfer';
    if (!categoryId || !accountId || amount <= 0 || savingRef.current) {
      return;
    }
    if (isTransfer && (!transferAccountId || transferAccountId === accountId)) {
      Alert.alert('Chuyển khoản', 'Hãy chọn hai tài khoản khác nhau.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const db = getDatabase();
      const created = await createTransaction(db, {
        type,
        amount,
        categoryId,
        accountId,
        transferAccountId: isTransfer ? transferAccountId : null,
        transferFee: isTransfer ? Number(transferFee.replace(/\D/g, '')) || 0 : 0,
        description: description.trim(),
        occurredAt: combineDateAndTime(formatIsoDate(localDateFromDate(date)), new Date()),
      });
      if (attachmentUri) {
        await addAttachment(db, { transactionId: created.id, localUri: attachmentUri, mimeType: 'image/jpeg' });
        committedRef.current = true;
      }
      await reviewBudgetAlert().catch(() => undefined);
      await setPreference(db, 'last_transaction_account', accountId);
      bump();
      router.back();
    } catch {
      Alert.alert('Giao dịch', 'Không lưu được. Hãy thử lại.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function onDateChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS !== 'ios') {
      setShowDate(false);
    }
    if (event.type !== 'dismissed' && selected) {
      setDate(selected);
    }
  }

  const seconds = Math.min(60, Math.floor(recording.durationMillis / 1000));

  return (
    <View style={styles.screen}>
      <StackHeader title="Thêm giao dịch" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.block}>
            <SegmentedControl
              value={type}
              onChange={(next) => {
                setType(next);
                setCategoryId(defaultCategory(categories, next));
              }}
              options={TRANSACTION_TYPE_OPTIONS}
            />
          </View>

          <NumericKeypad amount={amount} onChange={setAmount} />

          <View style={styles.block}>
            <View style={styles.actions}>
              <Action icon="pencil" label="AI text" onPress={() => { setMessage(null); setTextOpen(true); }} />
              <Action icon="mic" label="Giọng nói" onPress={() => { setMessage(null); setVoiceOpen(true); }} />
              <Action icon="camera" label="Camera" onPress={() => router.push('/transaction/camera')} />
              <Action icon="image" label="Thư viện" onPress={() => void chooseGallery()} />
            </View>

            <AppText variant="label" color={colors.textMuted}>Mô tả</AppText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={type === 'transfer' ? 'Ví dụ: Chuyển sang ví chi tiêu' : 'Ví dụ: Ăn sáng'}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Mô tả giao dịch"
              style={styles.input}
            />

            {type === 'transfer' ? (
              <>
                <AppText variant="caption" color={colors.textMuted}>Chuyển nội bộ không tính vào tổng thu hoặc tổng chi.</AppText>
                <AppText variant="label" color={colors.textMuted}>Từ tài khoản</AppText>
                <AccountPicker accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
                <AppText variant="label" color={colors.textMuted}>Đến tài khoản</AppText>
                <AccountPicker accounts={accounts.filter((account) => account.id !== accountId)} selectedId={transferAccountId} onSelect={setTransferAccountId} />
                <AppText variant="label" color={colors.textMuted}>Phí chuyển (không bắt buộc)</AppText>
                <TextInput value={transferFee} onChangeText={setTransferFee} keyboardType="number-pad" placeholder="0 ₫" placeholderTextColor={colors.textMuted} accessibilityLabel="Phí chuyển khoản" style={styles.input} />
              </>
            ) : (
              <>
                <AppText variant="label" color={colors.textMuted}>Hạng mục</AppText>
                <CategoryPicker categories={categories} type={type} selectedId={categoryId} onSelect={(category) => setCategoryId(category.id)} />
                <AppText variant="label" color={colors.textMuted}>Tài khoản</AppText>
                <AccountPicker accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
              </>
            )}

            <Pressable style={styles.dateRow} onPress={() => setShowDate(true)} accessibilityRole="button" accessibilityLabel="Chọn ngày giao dịch">
              <AppIcon name="calendar" color={colors.textMuted} />
              <AppText>{formatIsoDate(localDateFromDate(date)).split('-').reverse().join('/')}</AppText>
            </Pressable>
            {showDate ? (
              <View>
                <DateTimePicker value={date} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onDateChange} />
                {Platform.OS === 'ios' ? <Button label="Xong" variant="ghost" onPress={() => setShowDate(false)} /> : null}
              </View>
            ) : null}

            {attachmentUri ? (
              <View style={styles.preview}>
                <Image source={{ uri: attachmentUri }} style={styles.previewImage} contentFit="cover" />
                <Pressable onPress={removeImage} accessibilityLabel="Bỏ ảnh"><AppText variant="caption" color={colors.expenseText}>Bỏ ảnh</AppText></Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button
            label="Lưu giao dịch"
            onPress={() => void saveManual()}
            loading={saving}
            disabled={amount <= 0 || !categoryId || !accountId || (type === 'transfer' && (!transferAccountId || transferAccountId === accountId))}
          />
        </View>
      </KeyboardAvoidingView>

      {textOpen ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTextOpen(false)}>
          <View style={styles.backdrop}>
            <Pressable style={styles.dismiss} accessibilityLabel="Đóng" onPress={() => setTextOpen(false)} />
            <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
            <AppText variant="heading">Nhập chi tiêu</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              AI sẽ tách từng khoản, đọc số tiền và chọn hạng mục.
            </AppText>
            <TextInput
              value={draftText}
              onChangeText={setDraftText}
              multiline
              autoFocus
              placeholder="Ví dụ: Ăn sáng 35k, cà phê 25k"
              placeholderTextColor={colors.textSecondary}
              style={styles.area}
              textAlignVertical="top"
            />
            {message ? <AppText color={colors.expense}>{message}</AppText> : null}
            {busy ? <ActivityIndicator color={colors.primary} /> : null}
            <Button label="Phân tích" onPress={() => void analyze(draftText)} loading={busy} />
            <Button label="Đóng" variant="ghost" onPress={() => setTextOpen(false)} />
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal visible={voiceOpen} transparent animationType="fade" onRequestClose={() => setVoiceOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <AppText variant="heading">Giọng nói</AppText>
            <AppText variant="caption" color={colors.textSecondary} align="center">
              {recording.isRecording
                ? `Đang ghi 0:${String(seconds).padStart(2, '0')} / 1:00`
                : 'Nói khoản chi, tối đa 60 giây. AI sẽ tự tách và chọn hạng mục.'}
            </AppText>
            <Button
              label={recording.isRecording ? 'Dừng và phân tích' : 'Bắt đầu ghi'}
              variant={recording.isRecording ? 'danger' : 'primary'}
              onPress={() => void startRecording()}
              loading={busy && !recording.isRecording}
            />
            {message ? <AppText color={colors.expense}>{message}</AppText> : null}
            <Button
              label="Đóng"
              variant="ghost"
              onPress={() => {
                if (recording.isRecording) {
                  ignoreStop.current = true;
                  void recorder.stop();
                }
                setVoiceOpen(false);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <AppIcon name={icon} color={colors.primary} size={20} />
      <AppText variant="caption">{label}</AppText>
    </Pressable>
  );
}

function AccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: Account[];
  selectedId: string | null;
  onSelect: (accountId: string) => void;
}) {
  if (accounts.length === 0) {
    return <AppText variant="caption" color={colors.textMuted}>Chưa có tài khoản khả dụng.</AppText>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.accountChips}
    >
      {accounts.map((account) => {
        const selected = account.id === selectedId;
        return (
          <Pressable
            key={account.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(account.id)}
            style={[styles.accountChip, selected && styles.accountChipSelected]}
          >
            <AppText variant="caption" color={selected ? colors.surface : colors.text}>
              {account.name}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function defaultCategory(categories: Category[], type: TransactionType): string | null {
  if (type === 'transfer') {
    return categories.find((category) => category.id === 'cat_other')?.id ?? null;
  }
  if (type === 'income') {
    return categories.find((category) => category.id === 'cat_income')?.id ?? null;
  }
  return categories.find((category) => category.id === 'cat_food')?.id ?? categories[0]?.id ?? null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: 24,
    gap: 12,
  },
  block: {
    paddingHorizontal: 20,
    gap: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  action: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.text,
  },
  dateRow: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountChips: {
    gap: 8,
    paddingVertical: 2,
  },
  accountChip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  accountChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  dismiss: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 20,
    gap: 12,
    paddingBottom: 28,
  },
  area: {
    minHeight: 88,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    padding: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: colors.text,
  },
});
