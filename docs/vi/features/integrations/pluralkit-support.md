---
title: "Hỗ trợ PluralKit"
head:
  - tag: title
    content: "TomoriBot | Hỗ trợ PluralKit cho các hệ thống Plural trong Discord"
description: "TomoriBot hoạt động với tin nhắn proxy của PluralKit. Mỗi thành viên hệ thống được đối xử như một cá nhân độc lập với bộ nhớ cá nhân riêng, trong khi các cài đặt vẫn nằm trên tài khoản chủ."
sidebar:
  order: 3
---

TomoriBot hiểu các tin nhắn proxy từ [PluralKit](https://pluralkit.me/). Khi bật hỗ trợ, bot sẽ phản hồi tin nhắn webhook proxy thay vì tin nhắn gốc mà PluralKit đã xóa, đồng thời đối xử với từng thành viên trong hệ thống như một người có tên, danh tính và bộ nhớ cá nhân riêng thay vì gộp chung mọi người dưới tài khoản Discord được chia sẻ. Trang này mô tả khía cạnh người dùng của tính năng. Để biết chi tiết kỹ thuật nội bộ, hãy xem [kiến trúc adapter PluralKit](/en/architecture/integrations/pluralkit/). Mô hình an toàn dùng chung được đề cập trong [Hỗ trợ proxy tin nhắn](/vi/features/integrations/message-proxy-support/).

## Kích hoạt

Chạy `/personal message-proxy service:pluralkit`. Đây là lựa chọn cá nhân theo từng tài khoản, vì vậy ban quản trị máy chủ không cần cấu hình bất kỳ điều gì và thiết lập sẽ đi theo bạn qua các máy chủ. Các thành viên trong hệ thống của bạn không cần tham gia riêng lẻ; lựa chọn nằm trên tài khoản Discord gửi tin nhắn. Dùng `/personal message-proxy service:none` để tắt tính năng này.

Nếu bạn không dùng PluralKit, hãy tắt tùy chọn này. Mỗi tin nhắn bạn gửi sẽ phải chịu một độ trễ nhỏ mà không đem lại lợi ích gì (xem bên dưới).

## Những thay đổi khi được bật

- **Bot trả lời đúng tin nhắn.** Nếu không có tính năng này, PluralKit sẽ xóa tin nhắn gốc của bạn giữa chừng khi bot đang tạo câu trả lời và Tomori sẽ phản hồi một tin nhắn không tồn tại. Khi bật, bot sẽ đợi trong giây lát, nhận diện proxy và phản hồi bài đăng lại từ webhook, bao gồm cả các *lời hồi đáp* proxy cho tin nhắn của bot (vốn thường bị mất liên kết phản hồi trong quy trình proxy).
- **Hỗ trợ tin nhắn tiếp nối giữa chừng.** Việc gửi một tin nhắn proxy khác trong khi Tomori vẫn đang trả lời cùng một thành viên sẽ ngắt câu trả lời đó và bot sẽ trả lời tin nhắn mới nhất của thành viên đó. Một thành viên khác trên cùng tài khoản sẽ đợi đến lượt của mình, tương tự như một thành viên trên tài khoản khác.
- **Tạm dừng một chút ở tin nhắn của bạn.** Tomori đợi khoảng **2 giây** (người dùng self-hosting có thể điều chỉnh `MESSAGE_PROXY_WAIT_MS`) để xem liệu PluralKit có xóa và đăng lại tin nhắn của bạn hay không. Các tin nhắn qua proxy thường xử lý nhanh hơn khoảng thời gian đó; các tin nhắn không qua proxy chỉ đơn giản đến muộn hơn một chút. Đây là sự đánh đổi mà bạn chấp nhận khi bật tính năng và câu trả lời xác nhận của lệnh nêu rõ điều này.
- **Mỗi thành viên là một cá nhân riêng biệt.** Tomori nhận biết tên thành viên, hệ thống mà họ trực thuộc và tài khoản Discord làm chủ họ như ba dữ kiện độc lập. Việc xuất hiện với tư cách một thành viên khác đồng nghĩa với việc trò chuyện với bot như thành viên đó, không phải là "tài khoản".
- **Bộ nhớ cá nhân dành riêng cho từng thành viên.** Dữ kiện Tomori học được về một thành viên được lưu trữ cho *chính thành viên đó*. Dữ kiện này không trở thành bộ nhớ toàn máy chủ, không gắn vào tài khoản chủ và không rò rỉ sang các thành viên khác trong hệ thống.
- **Lần đầu gặp gỡ và hội ngộ cũng theo từng thành viên.** Bot theo dõi thời điểm nghe thấy tin nhắn từ từng thành viên một cách riêng biệt, vì vậy một thành viên đã lâu không trò chuyện sẽ nhận được lời chào khi quay lại, ngay cả khi có người khác đã nhắn tin từ cùng tài khoản đó suốt tuần. Một thành viên mà bot chưa từng gặp sẽ là lần gặp đầu tiên, và một thành viên đã trò chuyện hôm nay chỉ là một phần của cuộc đối thoại.
- **Nhập tiểu sử một lần duy nhất.** Lần đầu tiên Tomori thấy một thành viên, phần mô tả công khai trên PluralKit của thành viên đó (nếu có) có thể được lưu làm bộ nhớ cá nhân ban đầu để bot có thể tôn trọng đại từ nhân xưng, ranh giới và sở thích ngay từ cuộc trò chuyện đầu tiên. Đây là ảnh chụp nhanh một lần duy nhất. Việc chỉnh sửa tiểu sử trên PluralKit sau này sẽ không bao giờ cập nhật vào bot. Để thay đổi những gì bot nhớ, bạn chỉ cần nói trực tiếp trong đoạn chat ("hãy quên điều đó đi", "thực ra là...").
- **Nhập đại từ nhân xưng một lần duy nhất.** Nếu đại từ của thành viên được công khai trên PluralKit, chúng sẽ được điền vào cài đặt đại từ của chính thành viên đó trong lần đầu bot thấy họ nói chuyện, để bot sử dụng chúng ngay từ câu trả lời đầu tiên. Kể từ đó, cài đặt này là riêng giữa bạn và bot, do đó thay đổi sau này trên PluralKit sẽ không ghi đè lên và bạn có thể chỉnh sửa lại trong `/personal config identity:`. Thành viên giữ kín đại từ hoặc chưa thiết lập sẽ bắt đầu với trường trống.
- **Mô tả hệ thống được đọc khi các thành viên trò chuyện.** Nếu hệ thống của bạn có mô tả công khai, Tomori sẽ giữ lại và đọc nó mỗi khi bất kỳ thành viên nào của bạn tham gia cuộc trò chuyện, nhờ đó các ranh giới của toàn hệ thống sẽ áp dụng cho tất cả các bạn mà không cần lặp lại cho từng thành viên. Phần này *có* theo dõi các chỉnh sửa: thay đổi hoặc xóa mô tả trên PluralKit và bot sẽ tiếp nhận thay đổi đó trong lần tiếp theo một thành viên của bạn lên tiếng. Mô tả được hiển thị một lần cho toàn bộ hệ thống chứ không gắn với bất kỳ thành viên riêng lẻ nào, và phần mô tả riêng tư hoặc trống sẽ được lược bỏ thay vì thay thế bằng văn bản giữ chỗ.

## Các chi tiết về danh tính cần biết

- Các thành viên được nhận dạng bằng **ID nội bộ ổn định** của PluralKit, không bao giờ qua tên. Việc đổi tên thành viên hoặc đổi tên hiển thị hoàn toàn không ảnh hưởng gì: Tomori vẫn biết họ là cùng một người và chỉ cập nhật tên mới về mặt hiển thị.
- Danh tính xuất phát từ chính tin nhắn, không phải từ việc ai "đang xuất hiện phía trước": Tomori không bao giờ thăm dò người đang xuất hiện. Một thành viên trở thành một phần của cuộc trò chuyện ngay khi họ gửi tin nhắn proxy, và Tomori không có cách nào biết thành viên đó tồn tại cho đến khi họ gửi proxy ít nhất một lần trong khi bạn đang bật tính năng.
- **Gọi tên thành viên sẽ đưa họ vào ngữ cảnh**, chính xác như việc gọi tên một người tham gia bằng xương bằng thịt: nếu ai đó hỏi "Mirri nghĩ sao về việc này?", Tomori sẽ tải bộ nhớ của Mirri ngay cả khi Mirri không nói chuyện gần đây. Điều này chỉ áp dụng cho các thành viên của hệ thống có tài khoản chủ ở trong máy chủ, và một cái tên mơ hồ (hai người hoặc thành viên cùng có tên đó) sẽ bị bỏ qua thay vì đoán mò.
- Gọi **tên hệ thống** không gộp chung bộ nhớ của các thành viên. Chỉ những thành viên thực sự có mặt hoặc được gọi tên mới được tải vào ngữ cảnh, do đó cuộc trò chuyện của một thành viên đang xuất hiện sẽ không bao giờ để lộ dữ kiện về các thành viên không tham gia.
- Dữ liệu hệ thống riêng tư vẫn được giữ kín. Tomori chỉ nhìn thấy những gì PluralKit công khai về thành viên và hệ thống của tin nhắn đó; bot không có quyền truy cập vào các trường được bảo vệ bằng ACL của thành viên. Nếu tên hệ thống của bạn bị ẩn, bot sẽ dùng thẻ hệ thống của bạn, hoặc gọi đơn giản là "một hệ thống plural".

## Cài đặt vẫn nằm trên tài khoản chủ

Tài khoản Discord của bạn vẫn là nơi *kiểm soát* mọi thứ: mức độ riêng tư, danh sách đen, cooldown, hạn ngạch, khóa API và các cài đặt cấp tài khoản trong `/personal` được chia sẻ giữa các thành viên và gắn với tài khoản chủ. Đặt quyền riêng tư của bạn ở mức tối đa, hoặc bị đưa vào danh sách đen của máy chủ, sẽ bảo vệ **tất cả** các thành viên của bạn cùng một lúc. Chỉ có danh tính đối thoại, tùy chọn hồ sơ, ngoại hình và bộ nhớ mới được thiết lập riêng cho từng thành viên.

## Các hạn chế hiện tại

- `/personal memories identity:` chỉnh sửa bộ nhớ toàn cục và bộ nhớ theo persona của một thành viên đã lưu. Dùng `/personal config identity:` để chỉnh sửa hồ sơ, biệt danh và ngoại hình của thành viên đó.
- Việc nhập tiểu sử chỉ diễn ra đúng một lần cho mỗi thành viên. Các chỉnh sửa tiểu sử sau này trên PluralKit không bao giờ được đồng bộ. Hãy nói với bot trong đoạn chat thay vào đó.
- Tomori không thể `@` đề cập thành viên (webhook không thể được đề cập); bot sẽ gọi thành viên bằng tên.
- Nếu API PluralKit không thể xác minh tin nhắn được đăng lại, TomoriBot sẽ bỏ qua tin nhắn đó. Nếu PluralKit đã xóa tin nhắn gốc, TomoriBot sẽ không trả lời lượt đó. Không có danh tính thành viên nào được tạo.

Nếu một hạn chế không được liệt kê ở trên, hãy coi như tính năng sẽ hoạt động bình thường và báo cáo lỗi trong máy chủ hỗ trợ (`/support discord`).
