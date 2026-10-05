import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { aiConfig } from '@/src/config/ai';
import { describeAiError } from '@/src/services/ai/errors';
import { hasApiKey, hasBundledApiKey, removeApiKey, saveApiKey } from '@/src/services/ai/secure-config';
import { listModels } from '@/src/services/ai/shopaikey';
import { colors, radius } from '@/src/theme/tokens';

export default function AiSettingsScreen() {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bundled = hasBundledApiKey();

  useFocusEffect(
    useCallback(() => {
      hasApiKey().then(setReady).catch(() => setReady(false));
    }, []),
  );

  async function storeKey() {
    if (!key.trim()) {
      setMessage('Hãy nhập khóa API riêng của bạn.');
      return;
    }
    setBusy(true);
    try {
      await saveApiKey(key);
      setKey('');
      setReady(true);
      setMessage('Đã lưu khóa trong kho bảo mật của thiết bị.');
    } catch (error) {
      setMessage(describeAiError(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    try {
      await removeApiKey();
      setReady(false);
      setKey('');
      setMessage(bundled ? 'Đã xóa khóa trên thiết bị. App vẫn dùng khóa được đóng gói trong bản build.' : 'Đã xóa khóa API khỏi thiết bị.');
    } finally {
      setBusy(false);
    }
  }

  async function checkConnection() {
    setBusy(true);
    setMessage(null);
    try {
      const ids = await listModels();
      const hasChat = ids.includes(aiConfig.chatModel);
      const hasVoice = ids.includes(aiConfig.transcriptionModel);
      setMessage(
        `Kết nối thành công. ${aiConfig.chatModel}: ${hasChat ? 'sẵn sàng' : 'không có'}. ${aiConfig.transcriptionModel}: ${hasVoice ? 'sẵn sàng' : 'không có'}.`,
      );
    } catch (error) {
      setMessage(describeAiError(error));
    } finally {
      setBusy(false);
    }
  }

  function confirmClear() {
    Alert.alert('Xóa khóa API?', 'Các tính năng AI và chuyển giọng nói sẽ tạm dừng cho đến khi bạn nhập khóa mới.', [
      { text: 'Giữ lại', style: 'cancel' },
      { text: 'Xóa khóa', style: 'destructive', onPress: () => void clearKey() },
    ]);
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Trợ lý AI" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="bodyMedium">{ready ? (bundled ? 'Đã có khóa trong bản build' : 'Đã có khóa riêng trên thiết bị') : 'Chưa cấu hình khóa API'}</AppText>
        <AppText color={colors.textSecondary}>
          {bundled
            ? 'Bản build này đọc khóa từ src/config/ai.local.ts. Ứng dụng chỉ dùng khóa khi bạn chủ động dùng AI hoặc giọng nói.'
            : 'Khóa do bạn cung cấp được lưu bằng SecureStore. Ứng dụng chỉ dùng khóa khi bạn chủ động dùng AI hoặc giọng nói.'}
        </AppText>
        <AppText variant="label" color={colors.textSecondary}>Khóa ShopAIKey</AppText>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder={ready ? 'Nhập khóa mới để thay thế' : 'Nhập khóa API của bạn'}
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Khóa API ShopAIKey"
          style={styles.input}
        />
        <Button label={ready ? 'Thay khóa' : 'Lưu khóa'} onPress={() => void storeKey()} loading={busy} disabled={!key.trim()} />
        <View style={styles.meta}>
          <AppText variant="caption" color={colors.textSecondary}>Phân tích: {aiConfig.chatModel}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>Giọng nói: {aiConfig.transcriptionModel}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>{aiConfig.baseUrl}</AppText>
        </View>
        {message ? <AppText color={colors.textSecondary} accessibilityLiveRegion="polite">{message}</AppText> : null}
        <Button label="Kiểm tra kết nối" variant="secondary" onPress={() => void checkConnection()} loading={busy} disabled={!ready} />
        {ready && !bundled ? <Button label="Xóa khóa khỏi thiết bị" variant="ghost" onPress={confirmClear} disabled={busy} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
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
  meta: { gap: 4, paddingTop: 4 },
});
