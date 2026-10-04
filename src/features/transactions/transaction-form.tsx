import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';

import { Button } from '@/src/components/ui/Button';
import { AppIcon } from '@/src/components/ui/Icon';
import { AppText } from '@/src/components/ui/AppText';
import { NumericKeypad } from '@/src/components/ui/NumericKeypad';
import { CategoryPicker, SegmentedControl, TRANSACTION_TYPE_OPTIONS } from '@/src/components/ui/Pickers';
import { permissionDeniedMessage } from '@/src/services/ai/errors';
import { deleteImage, persistImage } from '@/src/services/images/attachments';
import { useDraftStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Category, TransactionType } from '@/src/types/finance';
import { combineDateAndTime, formatIsoDate, localDateFromDate, parseIsoDate } from '@/src/utils/dates';
export interface TransactionFormValue {
  type: TransactionType;
  amount: number;
  categoryId: string;
  description: string;
  occurredAt: string;
  attachmentUri: string | null;
  previousAttachmentUri: string | null;
}

export function TransactionForm({
  categories,
  initial,
  submitLabel,
  onSubmit,
}: {
  categories: Category[];
  initial?: Partial<TransactionFormValue>;
  submitLabel: string;
  onSubmit: (value: TransactionFormValue) => Promise<void>;
}) {
  const initialDate = initial?.occurredAt ? new Date(initial.occurredAt) : new Date();
  const [type, setType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial?.amount ?? 0);
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? defaultCategory(categories, initial?.type ?? 'expense'));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initialDate);
  const [showDate, setShowDate] = useState(false);
  const [attachmentUri, setAttachmentUri] = useState<string | null>(initial?.attachmentUri ?? null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const committedRef = useRef(false);
  const attachmentRef = useRef<string | null>(initial?.attachmentUri ?? null);
  attachmentRef.current = attachmentUri;

  useEffect(() => {
    return () => {
      const current = attachmentRef.current;
      if (!committedRef.current && current && current !== initial?.attachmentUri) {
        deleteImage(current);
      }
    };
  }, [initial?.attachmentUri]);
  const pendingAttachmentUri = useDraftStore((state) => state.pendingAttachmentUri);
  const setPendingAttachmentUri = useDraftStore((state) => state.setPendingAttachmentUri);

  useFocusEffect(
    useCallback(() => {
      if (!pendingAttachmentUri) {
        return;
      }
      setAttachmentUri((current) => {
        if (current && current !== initial?.attachmentUri) {
          deleteImage(current);
        }
        return pendingAttachmentUri;
      });
      setPendingAttachmentUri(null);
    }, [initial?.attachmentUri, pendingAttachmentUri, setPendingAttachmentUri]),
  );

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
      if (attachmentUri && attachmentUri !== initial?.attachmentUri) {
        deleteImage(attachmentUri);
      }
      setAttachmentUri(stored);
    } catch {
      Alert.alert('Ảnh', 'Không lưu được ảnh. Hãy thử lại.');
    }
  }

  function removeImage() {
    if (attachmentUri && attachmentUri !== initial?.attachmentUri) {
      deleteImage(attachmentUri);
    }
    setAttachmentUri(null);
  }

  async function save() {
    if (!categoryId || amount <= 0 || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setBusy(true);
    try {
      await onSubmit({
        type,
        amount,
        categoryId,
        description: description.trim(),
        occurredAt: combineDateAndTime(formatIsoDate(localDateFromDate(date)), initial?.occurredAt ? new Date(initial.occurredAt) : new Date()),
        attachmentUri,
        previousAttachmentUri: initial?.attachmentUri ?? null,
      });
      committedRef.current = true;
    } finally {
      savingRef.current = false;
      setBusy(false);
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

  return (
    <View style={styles.form}>
      <SegmentedControl
        value={type}
        onChange={(next) => {
          setType(next);
          setCategoryId(defaultCategory(categories, next));
        }}
        options={TRANSACTION_TYPE_OPTIONS}
      />
      {type === 'transfer' ? (
        <AppText variant="caption" color={colors.textSecondary}>
          Chuyển khoản nội bộ không tính vào tổng thu hoặc tổng chi.
        </AppText>
      ) : null}
      <AppText variant="label" color={colors.textSecondary} style={styles.label}>
        Hạng mục
      </AppText>
      <CategoryPicker categories={categories} type={type} selectedId={categoryId} onSelect={(category) => setCategoryId(category.id)} />
      <AppText variant="label" color={colors.textSecondary} style={styles.label}>
        Ghi chú
      </AppText>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Ví dụ: Ăn sáng"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
      />
      <Pressable style={styles.dateRow} onPress={() => setShowDate(true)} accessibilityRole="button">
        <AppIcon name="calendar" color={colors.textSecondary} />
        <AppText>{formatIsoDate(localDateFromDate(date)).split('-').reverse().join('/')}</AppText>
      </Pressable>
      {showDate ? (
        <View>
          <DateTimePicker value={date} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={onDateChange} />
          {Platform.OS === 'ios' ? <Button label="Xong" variant="ghost" onPress={() => setShowDate(false)} /> : null}
        </View>
      ) : null}
      <View style={styles.imageRow}>
        <Button label="Chụp ảnh" variant="secondary" onPress={() => router.push('/transaction/camera')} style={styles.imageButton} />
        <Button label="Thư viện" variant="secondary" onPress={() => void chooseGallery()} style={styles.imageButton} />
      </View>
      {attachmentUri ? (
        <View style={styles.preview}>
          <Image source={{ uri: attachmentUri }} style={styles.previewImage} contentFit="cover" />
          <Pressable onPress={removeImage} accessibilityLabel="Bỏ ảnh">
            <AppText variant="caption" color={colors.expense}>
              Bỏ ảnh
            </AppText>
          </Pressable>
        </View>
      ) : null}
      <NumericKeypad amount={amount} onChange={setAmount} />
      <Button label={submitLabel} onPress={() => void save()} loading={busy} disabled={amount <= 0 || !categoryId} />
    </View>
  );
}

function defaultCategory(categories: Category[], type: TransactionType): string | null {
  if (type === 'income') {
    return categories.find((category) => category.id === 'cat_income')?.id ?? null;
  }
  if (type === 'transfer') {
    return categories.find((category) => category.id === 'cat_other')?.id ?? null;
  }
  return categories.find((category) => category.id === 'cat_food')?.id ?? categories[0]?.id ?? null;
}

export function dateFromIso(value: string): Date {
  const local = parseIsoDate(value);
  return new Date(local.year, local.month - 1, local.day);
}

const styles = StyleSheet.create({
  form: {
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  label: {
    marginTop: 8,
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
  imageRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  imageButton: {
    flex: 1,
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
});
