---
title: "Natural Nudges"
description: "Cho phép các persona của TomoriBot chủ động bắt đầu cuộc trò chuyện khi kênh Discord trở nên yên ắng và tham gia vào những chủ đề phù hợp với sở thích của mình, với nhịp độ theo sát mức độ hoạt động của máy chủ."
sidebar:
  order: 4
aiGenerated: true
---

Natural Nudges cho phép TomoriBot lên tiếng mà không cần được tag trước, theo hai cách:

- **Gợi ý nhàn rỗi**: khi một kênh trở nên yên ắng, một trong các persona của bạn sẽ chọn một việc để làm, chẳng hạn như hỏi thăm ai đó, nối lại cuộc trò chuyện trước đó, nêu ra chủ đề mới hoặc diễn một hoạt cảnh ngắn với persona khác, rồi đăng tin nhắn bằng chính giọng điệu của mình.
- **Gợi ý chủ động**: khi các thành viên đang thảo luận về điều gì đó mà một persona yêu thích, persona đó sẽ tự động tham gia vào cuộc trò chuyện.

Các gợi ý này được thiết kế để mang lại cảm giác tự nhiên như một người bạn ghé qua hỏi thăm:

- **Nhịp độ bám sát máy chủ**: các máy chủ nói chuyện với TomoriBot mỗi ngày sẽ nhận được khoảng một gợi ý nhàn rỗi mỗi ngày; các máy chủ hiếm khi trò chuyện với bot sẽ không nhận được gợi ý nào, kể cả gợi ý chủ động.
- **Bot chờ đợi khoảng lặng tự nhiên**: gợi ý nhàn rỗi chỉ bắt đầu trong kênh đã yên ắng từ một đến ba giờ, vào khung giờ mà máy chủ của bạn thường thức và hoạt động.
- **Bot giữ im lặng khi không ai phản hồi**: mỗi gợi ý nhàn rỗi không được trả lời sẽ khiến lần tiếp theo phải đợi lâu hơn, và sau ba lần liên tiếp không ai trả lời, bot sẽ dừng lại cho đến khi có người trò chuyện lại.
- **Khi lưỡng lự, bot không nói gì**: nếu ai đó gửi tin nhắn trước, kênh bỗng trở nên bận rộn hoặc không tìm thấy điều gì phù hợp, gợi ý sẽ được hủy bỏ.

Natural Nudges chỉ hoạt động trong máy chủ, không bao giờ chạy trong tin nhắn trực tiếp (DM).

## Gợi ý chủ động
<!-- anchor: active-nudges -->

Gợi ý chủ động xảy ra khi một persona tham gia vào một cuộc trò chuyện đang diễn ra vì chủ đề đó trùng khớp với sở thích của mình. Quy trình diễn ra như sau:

1. Khi các thành viên trò chuyện trong kênh hợp lệ, TomoriBot sẽ đếm số lượng tin nhắn. Tin nhắn trong thread được tính là một phần của kênh mẹ, và số đếm sẽ đặt lại từ đầu mỗi khi có persona lên tiếng.
2. Định kỳ (nhanh hơn ở máy chủ đông đúc và thường xuyên hơn ở mức tần suất cao), bot sẽ đọc năm tin nhắn gần nhất và đánh giá xem cuộc trò chuyện có thực sự tập trung vào sở thích của persona nào hay không. Một lời nhắc thoáng qua sẽ không được tính.
3. Persona có sở thích đó sẽ trả lời. Nếu nhiều persona cùng chung sở thích, persona nào ít lên tiếng gần đây hơn thường sẽ được chọn, trong khi persona vừa nói chuyện sẽ nhường lượt. Đôi khi một persona khác sẽ lên tiếng thay thế, thường là persona ít khi được máy chủ trò chuyện cùng.
4. Câu trả lời sẽ xuất hiện sau 15 đến 45 giây, với đúng tính cách bình thường của persona. Nếu có persona khác lên tiếng trước, các thành viên chuyển chủ đề hoặc kênh trở nên bận rộn, bot sẽ không nói gì.

Mỗi kênh (bao gồm cả thread) chỉ có tối đa một gợi ý chủ động mỗi giờ, kèm theo giới hạn hàng ngày cho toàn bộ máy chủ. Persona cần có sở thích được thiết lập trong trang Gợi ý của mình để tham gia, và các persona Im lặng sẽ không bao giờ tham gia.

## Gợi ý nhàn rỗi
<!-- anchor: idle-nudges -->

Mỗi gợi ý nhàn rỗi thuộc về một danh mục cụ thể:

| Danh mục | Hoạt động diễn ra |
|---|---|
| **Tag thành viên** | Persona tag một thành viên mà mình quen biết: hỏi thăm, theo sát điều họ từng đề cập, gửi một liên kết họ có thể thích, trêu đùa về tựa game họ đang chơi hoặc đề nghị nhắc nhở họ điều gì đó. |
| **Nối lại chủ đề** | Persona tiếp tục một cuộc trò chuyện còn dang dở: trả lời câu hỏi chưa có lời đáp, đưa ra ý kiến thứ hai hoặc chia sẻ điều gì đó vừa tìm hiểu được. |
| **Bắt đầu chủ đề** | Persona nêu ra điều gì đó mới mẻ, thường từ chính sở thích của mình: một suy nghĩ, một góc nhìn thú vị, câu hỏi tình huống "bạn chọn cái nào", một mẩu tin tức, một bức ảnh hoặc một đoạn ghi âm giọng nói. |
| **Diễn hoạt cảnh** | Hai hoặc ba persona cùng trò chuyện với nhau trong một hoạt cảnh ngắn từ hai đến bốn tin nhắn: một cuộc tranh luận vui vẻ, bàn tán kế hoạch "bí mật" dành cho một thành viên, hỏi xin lời khuyên của nhau hoặc khoe một bức ảnh. |

`/nudge-studio` (cần quyền Quản lý máy chủ) có một tab riêng cho từng danh mục. Mỗi tab liệt kê các gợi ý nhàn rỗi của danh mục đó kèm theo một chấm tròn màu:

- 🟢 **Bật**: có thể được chọn để chạy.
- 🟡 **Bật, nhưng chưa thể chạy tại đây**: không persona nào có công cụ cần thiết, hoạt cảnh thiếu persona thứ hai hoặc không persona nào trong danh sách giới hạn có thể đưa ra gợi ý. Dòng đó sẽ nêu rõ điều còn thiếu.
- 🔴 **Tắt**.

**Bật/tắt tính khả dụng...** sẽ mở một gợi ý nhàn rỗi kèm theo ô đánh dấu cho từng persona:

- **Đánh dấu tất cả**: mọi persona đều có thể sử dụng, bao gồm cả các persona bạn thêm vào sau này.
- **Đánh dấu một số persona**: chỉ những persona đó mới được dùng, và dòng hiển thị sẽ nêu tên họ, chẳng hạn như "Nhắc nhở bạn? (chỉ Mirri và Juno)". Persona bạn thêm sau này sẽ không tham gia cho đến khi bạn tích chọn.
- **Không đánh dấu ô nào**: gợi ý nhàn rỗi đó sẽ bị tắt.

Bên dưới danh sách, bạn có thể tự thêm tối đa 25 gợi ý tùy chỉnh cho toàn bộ máy chủ. Nhấp vào một mục để chỉnh sửa; **Xóa gợi ý tùy chỉnh** liệt kê các gợi ý của bạn, và việc bỏ chọn sẽ xóa gợi ý đó. Mỗi gợi ý gồm có:

- **Tên**.
- **Tóm tắt chỉ dẫn**: điều persona dự định làm. Viết `{persona}` vào vị trí tên của persona đó, `{partner}` cho persona đồng hành trong hoạt cảnh và `{target}` cho thành viên được nhắm tới.
- **Mục tiêu ẩn** (tùy chọn): loại mục tiêu nhỏ mà persona tiếp tục theo đuổi sau câu mở đầu.
- **Điều kiện tiên quyết**: điều kiện phải thỏa mãn trước khi gợi ý nhàn rỗi có thể chạy, chẳng hạn như bộ nhớ gần đây hoặc công cụ khả dụng. Mỗi danh mục đã tự mang theo điều kiện riêng: một thành viên để tag, một cuộc trò chuyện dang dở hoặc persona thứ hai.
- **Công cụ khuyến nghị**: các công cụ persona được khuyến khích sử dụng khi có sẵn. Gợi ý nhàn rỗi vẫn chạy được nếu không có chúng. Công cụ đã chọn trong Điều kiện tiên quyết đã mặc định bắt buộc nên sẽ được bỏ khỏi danh sách này khi lưu.

### Tag thành viên
<!-- anchor: ping-user -->

Loại gợi ý nhàn rỗi này sẽ tag đích danh một thành viên, vì vậy nó chỉ chọn những người mà persona thực sự quen biết:

- **Họ đã nói chuyện với persona này gần đây**: chỉ những thành viên đã chủ động bắt đầu cuộc trò chuyện với persona đó trong máy chủ này trong vòng 14 ngày qua mới có thể được chọn. Việc chỉ được tag hoặc được nhắc tới trong câu chuyện không được tính, và việc thân thiết ở máy chủ khác cũng không được tính.
- **Persona biết họ**: thành viên đó có bộ nhớ với persona này trong vòng 30 ngày qua, hoặc có bộ nhớ ngắn hạn (STM) gần đây với persona.
- **Họ chưa chọn tắt tính năng**: bất kỳ ai cũng có thể tự tắt tính năng Persona tag bạn trong `/personal config` > Quyền riêng tư. Thành viên chọn mức quyền riêng tư Hoàn toàn, thành viên trong danh sách đen cá nhân hóa của máy chủ và thành viên bị persona chặn sẽ không bao giờ bị chọn.

Trong số các thành viên đủ điều kiện, những ai thân thiết hơn sẽ được chọn thường xuyên hơn: mỗi tin nhắn gửi tới persona đó tại máy chủ này trong 14 ngày qua, và mỗi kênh mà persona vừa trò chuyện với họ, đều làm tăng cơ hội được chọn. Người vừa được persona tag trong vòng ba ngày qua sẽ ít có nguy cơ bị chọn lại hơn. Lời tag chỉ gửi riêng cho thành viên đó; gợi ý tag thành viên không bao giờ tag vai trò, `@everyone` hay bất kỳ ai khác. Bất kỳ phản hồi nào trong kênh đều được tính là câu trả lời.

### Diễn hoạt cảnh
<!-- anchor: play-scene -->

Hoạt cảnh là một màn đối thoại ngắn giữa các persona, dài từ hai đến bốn tin nhắn. Persona mở đầu sẽ khơi mào câu chuyện và chọn một bạn diễn (đôi khi hai bạn diễn) từ những persona khác được phép hoạt động trong kênh đó. Các persona hoạt ngôn sẽ tham gia thường xuyên hơn, và persona Im lặng không bao giờ tham gia.

- **Thành viên luôn là ưu tiên hàng đầu**: khi bất kỳ ai gửi tin nhắn vào kênh trong lúc hoạt cảnh đang diễn ra, các tin nhắn còn lại của hoạt cảnh sẽ bị hủy và persona chuẩn bị nói tiếp sẽ trả lời thành viên đó, giống như khi có người bước vào cuộc trò chuyện. Nếu họ gọi tên hoặc tag đích danh một persona, persona đó sẽ trả lời.
- **Kế hoạch giữ kín riêng tư**: các persona có thể lên kế hoạch tạo bất ngờ vô hại cho một người quen, nhưng hoạt cảnh sẽ không tag thành viên đó.

### Mục tiêu ẩn

Cùng với câu mở đầu, mỗi gợi ý nhàn rỗi cung cấp cho persona một mục tiêu nhỏ riêng tư, chẳng hạn như "tìm xem còn ai thích bộ anime này nữa không". Mục tiêu này gắn liền phía trên câu mở đầu và chỉ persona đó mới nhìn thấy, giúp persona tiếp tục theo đuổi mục tiêu trong các câu trả lời tiếp theo. Trong một hoạt cảnh, mỗi persona nhận được mục tiêu riêng mà persona khác không hề biết. Khi câu mở đầu trôi ra khỏi phạm vi ngữ cảnh mà persona ghi nhớ, mục tiêu sẽ biến mất. Mục tiêu ẩn không bao giờ đòi hỏi thông tin cá nhân, tiền bạc hay bất cứ điều gì ngoài phạm vi cuộc trò chuyện. Các thành viên có quyền xem ảnh chụp nhanh prompt có thể đọc được các mục tiêu này.

## Cài đặt

Natural Nudges được bật theo mặc định và không cần thiết lập gì thêm. Khi mọi người trong máy chủ bắt đầu trò chuyện thường xuyên với TomoriBot, các gợi ý nhàn rỗi và gợi ý chủ động sẽ tự động khởi chạy tại những kênh họ nói chuyện với bot.

Để tùy chỉnh cách hoạt động, mở `/config` > Plugins > Natural Nudges (cần quyền Quản lý máy chủ):

- **Gợi ý nhàn rỗi** và **Gợi ý chủ động**: bật hoặc tắt từng tính năng riêng biệt.
- **Kênh**: hoạt động tự động với các kênh mà mọi người đã trò chuyện với TomoriBot trong 14 ngày qua (ngoại trừ kênh nhập vai). Bạn có thể tự tay chọn kênh cụ thể hoặc xóa danh sách để quay lại chế độ tự động. Kênh nơi các bot khác nhắn tin liên tục sẽ không bao giờ yên ắng, vì vậy bot sẽ tự bỏ qua.
- **Chọn model**: chọn hai model AI mà Natural Nudges sử dụng. Các model Google miễn phí chịu sự chi phối của điều khoản miễn phí của Google, vốn cho phép Google sử dụng các cuộc trò chuyện gửi tới chúng.
  - **Công cụ lập kế hoạch gợi ý nhàn rỗi**: lên kế hoạch cho các gợi ý nhàn rỗi. Mặc định là model trò chuyện của máy chủ. Không phải model nào cũng đảm đương được nhiệm vụ này; nếu model hiện tại không phù hợp, bảng điều khiển sẽ thông báo và cho phép bạn chọn model khác.
  - **Bộ kiểm tra gợi ý chủ động**: thỉnh thoảng xem xét cuộc trò chuyện để xác định xem có trùng khớp với sở thích nào không. Công cụ này chạy thường xuyên hơn nhiều so với bộ lập kế hoạch, vì vậy một model nhỏ, chi phí thấp là phù hợp nhất. Mặc định TomoriBot sẽ tự động chọn cho bạn: một model Quyết định (model nhỏ chuyên giải quyết các câu hỏi chọn một phương án nhanh chóng) nếu máy chủ có khóa OpenRouter, Gemma 4 31B nếu có khóa Google, hoặc dùng chung Công cụ lập kế hoạch gợi ý nhàn rỗi. Bạn có thể tự chọn bất kỳ model nào trong số này, bao gồm cả model Quyết định tùy chỉnh.

Bảng điều khiển hiển thị mức độ hoạt động của máy chủ, số lượng gợi ý nhàn rỗi dự kiến mỗi tuần và tần suất kiểm tra gợi ý chủ động.

### Tần suất hoạt động

- **Tần suất**: đặt nhịp độ riêng cho gợi ý nhàn rỗi và gợi ý chủ động: Hiếm khi, Nhẹ nhàng (mặc định), Bình thường hoặc Sôi nổi. Ngay cả ở mức Sôi nổi, bot vẫn sẽ giữ im lặng ở máy chủ hiếm khi trò chuyện với TomoriBot.
- **Giới hạn hàng ngày**: điều chỉnh theo mức tần suất: Hiếm khi cho phép 1 gợi ý nhàn rỗi và 1 gợi ý chủ động mỗi ngày; Nhẹ nhàng là 3 mỗi loại; Bình thường là 5 gợi ý nhàn rỗi và 6 gợi ý chủ động; Sôi nổi là 8 gợi ý nhàn rỗi và 10 gợi ý chủ động.
- **Giới hạn kiểm tra**: ngăn gợi ý chủ động làm cạn kiệt hạn mức khóa AI: TomoriBot kiểm tra cuộc trò chuyện tối đa 10 lần mỗi ngày ở mức Hiếm khi, 20 lần ở mức Nhẹ nhàng, 40 lần ở mức Bình thường và 60 lần ở mức Sôi nổi. Sau một lần kiểm tra không tìm thấy chủ đề phù hợp, kênh đó sẽ phải đợi lâu hơn trước lần kiểm tra tiếp theo, từ 10 phút lên tới 3 giờ. Nếu nhà cung cấp AI báo rằng khóa đã chạm trần hạn ngạch, gợi ý chủ động sẽ tạm dừng trong 3 giờ.

### Khi tính năng tiếp tục tắt

- **Thống kê sử dụng bị tắt**: TomoriBot đánh giá mức độ hoạt động của máy chủ dựa trên dữ liệu thống kê sử dụng. Nếu người lưu trữ bot tắt tính năng này, các gợi ý sẽ không bao giờ bắt đầu.
- **Thành viên tự dùng khóa riêng (BYOK)**: nếu máy chủ yêu cầu từng thành viên tự dùng khóa AI riêng, không có khóa của ai chi trả cho tin nhắn mà không ai yêu cầu, do đó Natural Nudges sẽ tiếp tục tắt.

## Cài đặt theo Persona

Mỗi persona có một trang **Gợi ý** riêng trong `/config` > Persona:

- **Độ hoạt ngôn**: mức độ thường xuyên persona này là người lên tiếng. Các persona Im lặng không bao giờ khởi xướng gợi ý nhàn rỗi cũng như không tham gia gợi ý chủ động; persona ngại ngùng ít nói hơn, persona hoạt ngôn sẽ nói nhiều hơn.
- **Sở thích**: tối đa 8 chủ đề persona thích nêu ra và tham gia thảo luận, mỗi chủ đề kèm theo mô tả ngắn gọn và ví dụ (chẳng hạn như **anime mecha**: thể loại hư cấu về robot khổng lồ có người lái, như Gundam).

Các preset chính thức được tích hợp sẵn sở thích và độ hoạt ngôn riêng. `/persona generate` sẽ gợi ý sở thích cho các nhân vật mới, và tệp xuất persona cũng sẽ mang theo các thiết lập này.

## Dữ liệu được lưu trữ

Natural Nudges lưu trữ cài đặt của bạn, các gợi ý nhàn rỗi tùy chỉnh và sở thích của persona cùng với các cấu hình máy chủ khác. Tính năng này cũng ghi nhớ các gợi ý nhàn rỗi và chủ động đã chạy gần đây, liệu có ai phản hồi hay không và ai là người nhận gợi ý tag trong 30 ngày, đồng thời lưu giữ từng mục tiêu ẩn tối đa 90 ngày. Chạy `/reset` sẽ khôi phục cài đặt gốc và xóa các gợi ý tùy chỉnh. `/export config` và `/import config` mang theo các cài đặt và gợi ý tùy chỉnh, nhưng không bao gồm danh sách kênh đã chọn (vốn thuộc về một máy chủ cụ thể). Tùy chọn Persona tag bạn của riêng bạn thuộc về cài đặt cá nhân: `/reset personal config` sẽ giữ lại, `/export personal config` sẽ xuất ra và `/personal nuke` sẽ xóa sạch cùng với phần còn lại của dữ liệu cá nhân của bạn.
