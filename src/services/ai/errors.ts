export function describeAiError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Hết thời gian chờ dịch vụ AI.';
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Không kết nối được dịch vụ AI.';
}

export function permissionDeniedMessage(kind: 'microphone' | 'camera' | 'photos' | 'notifications'): string {
  const messages = {
    microphone: 'Chưa có quyền micro. Hãy bật quyền trong cài đặt máy để ghi âm.',
    camera: 'Chưa có quyền camera. Hãy bật quyền trong cài đặt máy để chụp ảnh.',
    photos: 'Chưa có quyền thư viện ảnh. Hãy bật quyền trong cài đặt máy để chọn ảnh.',
    notifications: 'Chưa có quyền thông báo. Nhắc nhở sẽ không hiện cho đến khi bạn cấp quyền.',
  };
  return messages[kind];
}
