import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { permissionDeniedMessage } from '@/src/services/ai/errors';
import { persistImage } from '@/src/services/images/attachments';
import { useDraftStore } from '@/src/store/app-store';
import { colors } from '@/src/theme/tokens';

export default function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const setPendingAttachmentUri = useDraftStore((state) => state.setPendingAttachmentUri);

  async function capture() {
    if (!cameraRef.current || busy) {
      return;
    }
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) {
        setMessage('Không chụp được ảnh.');
        return;
      }
      const stored = await persistImage(photo.uri);
      setPendingAttachmentUri(stored);
      router.back();
    } catch {
      setMessage('Không lưu được ảnh. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  }

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <AppText variant="heading">Cần quyền camera</AppText>
        <AppText color={colors.textSecondary}>{permissionDeniedMessage('camera')}</AppText>
        <Button label="Cho phép camera" onPress={() => void requestPermission()} />
        <Button label="Đóng" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      <View style={styles.controls}>
        {message ? <AppText color={colors.surface}>{message}</AppText> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Chụp" style={styles.shutter} onPress={() => void capture()} />
        <Button label="Đóng" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111',
  },
  camera: {
    flex: 1,
  },
  controls: {
    padding: 20,
    gap: 16,
    alignItems: 'center',
    backgroundColor: '#111',
  },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
  },
  permission: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
});
