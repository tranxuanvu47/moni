# Mono

Ứng dụng ghi chi tiêu cá nhân, tiếng Việt, tiền VND. Dữ liệu nằm trên máy. Trợ lý AI là tùy chọn.

## Chạy trên máy

```bash
npm install
npx expo start
```

Bản này dùng module native (SQLite, camera, micro, thông báo). Expo Go có thể thiếu một số module của SDK 57. Để cài lên điện thoại Android, hãy build APK ở dưới.

Kiểm tra mã:

```bash
npm test
npx tsc --noEmit
```

## Cài APK trên máy

Bản này dùng module native (SQLite, Firebase, camera). Không chạy trong Expo Go và không cần EAS.

```bash
npm install
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleDebug
```

APK debug nằm ở `android/app/build/outputs/apk/debug/`. Gói Android: `com.aitiman.moni`.

`google-services.json` ở thư mục gốc là cấu hình client của project `aitiman-moni`. Không nhét service account hay private key vào app.

## Firebase

1. Firebase Console, project `aitiman-moni`: bật Authentication → Email/Password. Google Sign-In cần thêm SHA-1.
2. Lấy SHA-1 sau khi prebuild: `cd android` rồi `.\gradlew.bat signingReport`. Dán SHA-1 và SHA-256 vào app Android `com.aitiman.moni`, tải lại `google-services.json`.
3. Copy Web client ID (loại Web, không phải Android client) vào `src/config/firebase.local.ts`, rồi build lại.
4. Firestore Standard, database `(default)`, region `asia-southeast1` nếu chọn được. Dán `firestore.rules` vào tab Rules, hoặc `npx firebase-tools deploy --only firestore:rules,firestore:indexes`.
5. Rules chỉ cho `request.auth.uid` đọc `users/{uid}`. Không dùng `allow read, write: if true`.
6. Đăng nhập lần đầu trên máy đã có giao dịch sẽ hỏi trước khi tải dữ liệu lên. Tài khoản khác không được nhận sổ của máy này.
7. Ảnh hóa đơn vẫn ở máy. Cloud Storage chưa bật. ShopAIKey giữ nguyên, không đưa vào cấu hình Firebase.

Hạn mức Spark (đọc 50.000 / ghi 20.000 document mỗi ngày) đủ cho sổ cá nhân nếu không lắng nghe cả collection mỗi lần mở app. App chỉ kéo document có `updatedAt` mới hơn mốc lần kéo trước.

## Quyền

- Micro: chỉ khi bạn bấm ghi âm.
- Camera và thư viện ảnh: chỉ khi đính kèm ảnh.
- Thông báo: chỉ khi bật nhắc nhở hoặc cảnh báo ngân sách.

Ảnh được chép vào thư mục của ứng dụng. Không tự tải lên.

## AI

Khóa không nhập trên từng máy Android. Sao chép `src/config/ai.local.example.ts` thành `src/config/ai.local.ts`, dán khóa ShopAIKey vào `aiApiKey`, rồi build lại. File này bị git bỏ qua. Khóa sẽ nằm trong APK.

URL mặc định: `https://api.shopaikey.com/v1`.

Model phân tích: `gpt-4o-mini`. Model giọng nói: `whisper-1`. Cả hai khai báo trong `src/config/ai.ts`. Câu đơn giản như “ăn sáng 35k” được tách trên máy. AI chỉ được gọi khi còn khoản chưa rõ, hoặc khi bạn bấm “Nhờ AI đọc lại” / “Giải thích thêm”.

Giọng nói cần mạng. App không giả vờ nhận dạng giọng nói khi ngoại tuyến.

Khóa lưu trên máy không thay cho một backend giữ bí mật. Trước khi gửi ghi âm hoặc số liệu tổng hợp, hãy xem điều khoản của nhà cung cấp.

Xem thêm `.env.example`.

## Phạm vi đã làm

- Nhập, sửa, xóa giao dịch offline, lưu SQLite, còn sau khi mở lại app.
- Tách câu tiếng Việt trên máy, có bước kiểm tra trước khi lưu.
- AI, giọng nói và giải thích chỉ khi đã cấu hình.
- Ảnh từ camera hoặc thư viện, nén và lưu local.
- Thống kê ngày / tuần / tháng / năm từ dữ liệu thật.
- Ngân sách tháng, ngân sách hạng mục, nhắc local.
- Xuất / nhập CSV, xóa dữ liệu, không có giao dịch mẫu.
- Đồng bộ Firestore theo tài khoản Firebase. SQLite vẫn là sổ local. Google Sheets chỉ còn lệnh nhập một lần, không còn là đường đồng bộ đang chạy.

Chưa làm: Cloud Storage cho ảnh, OCR hóa đơn, listener thông báo ngân hàng, phát hành Play Store hoặc App Store.
