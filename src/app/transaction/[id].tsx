import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { AmountText } from '@/src/components/ui/AmountText';
import { Button } from '@/src/components/ui/Button';
import { AppText } from '@/src/components/ui/AppText';
import { StackHeader } from '@/src/components/ui/Header';
import { getDatabase } from '@/src/database/expo-client';
import { listCategories } from '@/src/database/repositories/categories';
import {
  addAttachment,
  deleteAttachment,
  deleteTransaction,
  getTransaction,
  listAttachments,
  updateTransaction,
} from '@/src/database/repositories/transactions';
import { TransactionForm, type TransactionFormValue } from '@/src/features/transactions/transaction-form';
import { deleteImage } from '@/src/services/images/attachments';
import { reviewBudgetAlert } from '@/src/services/notifications/reminders';
import { useDataStore } from '@/src/store/app-store';
import { colors, radius } from '@/src/theme/tokens';
import type { Attachment, Category, TransactionListItem } from '@/src/types/finance';
import { formatDayLabel, localDateFromDate, parseIsoDate } from '@/src/utils/dates';

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bump = useDataStore((state) => state.bump);
  const [item, setItem] = useState<TransactionListItem | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    if (!id) {
      return;
    }
    const db = getDatabase();
    const [next, files, cats] = await Promise.all([getTransaction(db, id), listAttachments(db, id), listCategories(db)]);
    setItem(next);
    setAttachments(files);
    setCategories(cats);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  async function save(value: TransactionFormValue) {
    if (!id) {
      return;
    }
    const db = getDatabase();
    await updateTransaction(db, id, value);
    const removed = value.previousAttachmentUri && value.previousAttachmentUri !== value.attachmentUri;
    const added = value.attachmentUri && value.attachmentUri !== value.previousAttachmentUri;
    if (removed) {
      for (const attachment of attachments) {
        const uri = await deleteAttachment(db, attachment.id);
        deleteImage(uri);
      }
    }
    if (added && value.attachmentUri) {
      await addAttachment(db, { transactionId: id, localUri: value.attachmentUri, mimeType: 'image/jpeg' });
    }
    await reviewBudgetAlert().catch(() => undefined);
    bump();
    setEditing(false);
    await reload();
  }

  function remove() {
    if (!id) {
      return;
    }
    Alert.alert('Xóa giao dịch', 'Khoản này sẽ ẩn trên máy. Nếu đang đồng bộ, trạng thái xóa sẽ được cập nhật trên các máy khác của cùng tài khoản.', [
      { text: 'Giữ lại', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const db = getDatabase();
            for (const attachment of attachments) {
              deleteImage(attachment.localUri);
            }
            await deleteTransaction(db, id);
            bump();
            router.back();
          })();
        },
      },
    ]);
  }

  if (!item) {
    return (
      <View style={styles.screen}>
        <StackHeader title="Giao dịch" />
        <AppText style={styles.missing}>Không tìm thấy giao dịch.</AppText>
      </View>
    );
  }

  const day = formatDayLabel(parseIsoDate(item.occurredAt.slice(0, 10)), localDateFromDate(new Date()));

  return (
    <View style={styles.screen}>
      <StackHeader title={editing ? 'Sửa giao dịch' : 'Chi tiết'} />
      <ScrollView contentContainerStyle={styles.content}>
        {editing ? (
          <TransactionForm
            categories={categories}
            submitLabel="Lưu thay đổi"
            initial={{
              type: item.type,
              amount: item.amount,
              categoryId: item.categoryId,
              description: item.description,
              occurredAt: item.occurredAt,
              attachmentUri: attachments[0]?.localUri ?? null,
            }}
            onSubmit={save}
          />
        ) : (
          <View style={styles.detail}>
            <AmountText amount={item.amount} type={item.type} size="lg" />
            <AppText variant="heading">{item.description || item.categoryName}</AppText>
            <AppText color={colors.textSecondary}>
              {item.categoryName} · {day} · {item.occurredAt.slice(11, 16)}
            </AppText>
            {attachments.map((attachment) => (
              <Image key={attachment.id} source={{ uri: attachment.localUri }} style={styles.image} contentFit="cover" />
            ))}
            <Button label="Sửa" onPress={() => setEditing(true)} />
            <Button label="Xóa" variant="danger" onPress={remove} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 32,
  },
  detail: {
    paddingHorizontal: 20,
    gap: 12,
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: radius.lg,
  },
  missing: {
    padding: 20,
  },
});
