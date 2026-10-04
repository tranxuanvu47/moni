import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { StackHeader } from '@/src/components/ui/Header';
import { aiConfig } from '@/src/config/ai';
import { describeAiError } from '@/src/services/ai/errors';
import { hasApiKey } from '@/src/services/ai/secure-config';
import { listModels } from '@/src/services/ai/shopaikey';
import { colors } from '@/src/theme/tokens';

export default function AiSettingsScreen() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      hasApiKey().then(setReady).catch(() => setReady(false));
    }, []),
  );

  async function checkConnection() {
    setBusy(true);
    setMessage(null);
    try {
      const ids = await listModels();
      const hasChat = ids.includes(aiConfig.chatModel);
      const hasVoice = ids.includes(aiConfig.transcriptionModel);
      setMessage(
        `Kết nối được. ${ids.length} model. ${aiConfig.chatModel}: ${hasChat ? 'có' : 'không thấy trong danh sách'}. ${aiConfig.transcriptionModel}: ${hasVoice ? 'có' : 'không thấy trong danh sách'}.`,
      );
    } catch (error) {
      setMessage(describeAiError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <StackHeader title="Trợ lý AI" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="bodyMedium">{ready ? 'Khóa đã gắn trong bản build' : 'Bản build chưa có khóa'}</AppText>
        <AppText color={colors.textSecondary}>
          Model được chọn trong mã nguồn. Máy Android không cần nhập khóa. Đổi khóa hoặc model thì sửa project rồi build lại.
        </AppText>
        <AppText>Phân tích: {aiConfig.chatModel}</AppText>
        <AppText>Giọng nói: {aiConfig.transcriptionModel}</AppText>
        <AppText color={colors.textSecondary}>{aiConfig.baseUrl}</AppText>
        {message ? <AppText color={colors.textSecondary}>{message}</AppText> : null}
        <Button label="Kiểm tra kết nối" variant="secondary" onPress={() => void checkConnection()} loading={busy} disabled={!ready} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
});
