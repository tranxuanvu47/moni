import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import type { DatabaseClient } from '@/src/database/client';
import { countReviewableInboxDrafts } from '@/src/database/repositories/inbox';
import { formatVnd } from '@/src/utils/money';

const INBOX_CHANNEL_ID = 'transaction-review';

export async function ensureInboxNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(INBOX_CHANNEL_ID, {
    name: 'Giao dịch cần kiểm tra',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function syncInboxBadgeCount(db: DatabaseClient): Promise<number> {
  const count = await countReviewableInboxDrafts(db);
  await Notifications.setBadgeCountAsync(count).catch(() => false);
  return count;
}

export async function notifyInboxDraftCreated(input: {
  db: DatabaseClient;
  description: string;
  amount: number;
}): Promise<void> {
  const count = await syncInboxBadgeCount(input.db);
  if (Platform.OS !== 'android') {
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return;
  }

  await ensureInboxNotificationChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: count > 1 ? `${count} giao dịch cần kiểm tra` : 'Giao dịch cần kiểm tra',
      body: `${input.description || 'Giao dịch mới'} · ${formatVnd(input.amount)}`,
      badge: count,
      data: { url: '/settings/inbox' },
    },
    trigger: { channelId: INBOX_CHANNEL_ID },
  });
}
