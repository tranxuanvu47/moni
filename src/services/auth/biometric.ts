import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

export async function biometricAvailability(): Promise<{
  available: boolean;
  enrolled: boolean;
  label: string;
  reason: string | null;
}> {
  if (Platform.OS === 'web') {
    return { available: false, enrolled: false, label: 'Sinh trắc học', reason: 'Web không hỗ trợ vân tay / Face ID.' };
  }
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const label = biometricLabel(types);
    if (!hasHardware) {
      return { available: false, enrolled: false, label, reason: 'Máy này không có cảm biến sinh trắc học.' };
    }
    if (!enrolled) {
      return { available: false, enrolled: false, label, reason: `Chưa đăng ký ${label.toLowerCase()} trên máy.` };
    }
    return { available: true, enrolled: true, label, reason: null };
  } catch {
    return { available: false, enrolled: false, label: 'Sinh trắc học', reason: 'Không kiểm tra được sinh trắc học trên bản này.' };
  }
}

export async function promptBiometric(promptMessage: string): Promise<boolean> {
  const availability = await biometricAvailability();
  if (!availability.available) {
    throw new Error(availability.reason ?? 'Sinh trắc học chưa sẵn sàng.');
  }
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Hủy',
    disableDeviceFallback: false,
    biometricsSecurityLevel: 'weak',
  });
  return result.success;
}

function biometricLabel(types: LocalAuthentication.AuthenticationType[]): string {
  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const hasFinger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  if (hasFace && hasFinger) {
    return 'Vân tay / Face ID';
  }
  if (hasFace) {
    return Platform.OS === 'ios' ? 'Face ID' : 'Khuôn mặt';
  }
  if (hasFinger) {
    return 'Vân tay';
  }
  return 'Sinh trắc học';
}
