import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { StackHeader } from '@/src/components/ui/Header';
import { colors } from '@/src/theme/tokens';

export default function PrivacyScreen() {
  return (
    <View style={styles.screen}>
      <StackHeader title="Quyền riêng tư" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText>
          Giao dịch, ảnh và ngân sách được lưu trên máy này trước. Đồng bộ đám mây chỉ chạy sau khi bạn đăng nhập và xác nhận gắn dữ liệu máy với đúng tài khoản. Ảnh đính kèm vẫn ở trên máy trong bản này.
        </AppText>
        <AppText>
          Nếu bật nhớ mật khẩu hoặc mở khóa bằng vân tay / Face ID, thông tin cần thiết được lưu trong kho bảo mật của máy để đăng nhập lại nhanh. Bạn có thể tắt bất cứ lúc nào trong Tài khoản.
        </AppText>
        <AppText>
          Tính năng thông báo ngân hàng (Android) chỉ đọc thông báo từ các app ngân hàng/ví đã lọc khi bạn cấp quyền truy cập thông báo. OTP bị bỏ qua. Nội dung không được gửi lên máy chủ chỉ để lưu giao dịch trên máy.
        </AppText>
        <AppText>
          Ảnh đính kèm được chép vào thư mục của ứng dụng. Ảnh không được tải lên trừ khi một tính năng sau này được bạn bật riêng.
        </AppText>
        <AppText>
          Trợ lý AI là tùy chọn. Nhập tay, lưu giao dịch, thống kê và nhắc nhở vẫn chạy khi không có mạng. Câu đơn giản được tách ngay trên máy.
        </AppText>
        <AppText>
          Khi bạn bấm tách câu chưa rõ, ghi âm, hoặc “Giải thích thêm”, máy gửi đúng phần cần thiết tới địa chỉ API bạn đã cấu hình. Ghi âm không được nhận dạng khi máy ngoại tuyến.
        </AppText>
        <AppText>
          Khóa API được gắn lúc build từ project. Người có file APK có thể tách khóa ra. Chỉ cài bản này cho máy của bạn.
        </AppText>
        <AppText color={colors.textSecondary}>Bạn có thể xuất CSV, nhập lại bản sao lưu, hoặc xóa toàn bộ dữ liệu trong Cài đặt.</AppText>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16 },
});
