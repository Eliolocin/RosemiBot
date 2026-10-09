---
title: Điều khoản dịch vụ
description: Các điều khoản chi phối việc sử dụng instance TomoriBot chính thức được lưu trữ.
aiGenerated: false
---

*Bản dịch này chỉ nhằm mục đích thuận tiện cho bạn tham khảo. Trong trường hợp có sự mâu thuẫn giữa bản dịch và bản tiếng Anh, bản tiếng Anh sẽ được ưu tiên áp dụng.*

Cập nhật lần cuối: 2026-09-12

Bằng cách thiết lập hoặc tương tác với TomoriBot, bạn chấp nhận các Điều khoản này cùng với Điều khoản dịch vụ và Nguyên tắc cộng đồng của Discord. Các Điều khoản này áp dụng cho instance TomoriBot chính thức được lưu trữ trên Discord. Nếu bạn tự chạy bản sao của riêng mình từ repository mã nguồn mở của TomoriBot, bạn không bị ràng buộc bởi các Điều khoản này; việc sử dụng của bạn sẽ chịu sự điều chỉnh của giấy phép AGPLv3 trong tệp `LICENSE`, và bạn là người duy nhất kiểm soát việc xử lý dữ liệu trong môi trường self-hosted của mình.

## 1) Định nghĩa thuật ngữ
Để rõ ràng, các thuật ngữ sau được sử dụng xuyên suốt tài liệu này:
- Máy chủ (Server): Một cộng đồng/guild Discord nơi TomoriBot được thiết lập
- Bộ nhớ (Memories): Các dữ kiện hoặc thông tin được dạy cho TomoriBot qua các lệnh, hoặc do bot tự học thông qua công cụ hàm `remember_this_fact`
- **Persona/Preset**: Các hồ sơ tính cách và hành vi có thể cấu hình để thay đổi cách TomoriBot phản hồi
- Nhà cung cấp (Provider): Các dịch vụ tìm kiếm hoặc AI của bên thứ ba (ví dụ: Google, NovelAI, OpenRouter, Brave Search) mà bạn cấu hình cho TomoriBot sử dụng
- Instance có sẵn (Hosted Instance): Dịch vụ TomoriBot chính thức được duy trì dưới dạng bot công khai cho Discord, trái ngược với các bản sao self-hosted
- Khóa API (API Key): Thông tin xác thực bạn cung cấp để kết nối TomoriBot với các Nhà cung cấp đã chọn
- Kích hoạt (Trigger): Một sự kiện khiến TomoriBot tạo câu trả lời trong kênh văn bản Discord bằng nhà cung cấp bạn đã cấu hình, chẳng hạn như: tag bot, trả lời tin nhắn của bot, sử dụng các lệnh slash yêu cầu xử lý AI/tìm kiếm, hoặc gửi tin nhắn trong các kênh đã bật tự động trả lời. Các lần kích hoạt sẽ tiêu tốn tín dụng/token API từ tài khoản nhà cung cấp của bạn.
- Người quản lý máy chủ (Server Manager): Thành viên có quyền cấu hình TomoriBot cho một Máy chủ, chẳng hạn như thành viên chạy lệnh `/setup`

## 2) Phạm vi dịch vụ
- TomoriBot là một chatbot vận hành bằng AI, phản hồi các tương tác trên Discord bằng cách sử dụng các Nhà cung cấp bên ngoài do bạn cấu hình.
- Chúng tôi có thể thay đổi, tạm ngừng hoặc chấm dứt các tính năng của TomoriBot bất kỳ lúc nào vì lý do bảo trì, an toàn hoặc pháp lý.

## 3) Ai chấp nhận điều gì
- Người quản lý máy chủ chấp nhận các Điều khoản này cho Máy chủ khi hoàn tất `/setup`, và xác nhận tại đó rằng họ đã đọc Chính sách quyền riêng tư và sẽ công khai thông tin đó cho các thành viên của Máy chủ.
- Người quản lý máy chủ không thể thay mặt thành viên khác chấp nhận các Điều khoản này, và không bảo đảm về độ tuổi hay hành vi của bất kỳ thành viên nào khác. Mỗi thành viên tự mình chấp nhận các Điều khoản này khi tương tác với TomoriBot.
- Các thành viên có thể đọc các tài liệu hiện hành bất kỳ lúc nào bằng lệnh `/legal terms-of-service` và `/legal privacy-policy`.
- Người quản lý máy chủ có trách nhiệm thông báo cho các thành viên của họ rằng TomoriBot đã được cài đặt và cách bot xử lý tin nhắn, cũng như sử dụng các tùy chọn kiểm soát kênh và vai trò có sẵn để giới hạn phạm vi TomoriBot đọc tin nhắn.

## 4) Trách nhiệm của bạn
- Không sử dụng TomoriBot cho các nội dung vi phạm pháp luật, có hại hoặc bị nền tảng cấm, hành vi quấy rối hoặc các nỗ lực truy cập trái phép.
- Bạn phải đáp ứng độ tuổi tối thiểu mà Discord yêu cầu tại quốc gia của bạn, tối thiểu là 13 tuổi, để sử dụng TomoriBot. Bằng việc sử dụng dịch vụ, bạn cam đoan rằng mình đáp ứng yêu cầu về độ tuổi này.
- Bạn chịu trách nhiệm về nội dung mình cung cấp (tin nhắn, bộ nhớ, dữ liệu persona, tệp tải lên). Hãy đảm bảo bạn có quyền chia sẻ nội dung đó và tránh các dữ liệu nhạy cảm mà bạn không muốn các Nhà cung cấp đã cấu hình xử lý.
- Tôn trọng các giới hạn tần suất (rate limit) và tránh spam hoặc lạm dụng làm suy giảm chất lượng dịch vụ.

## 5) Nội dung giới hạn độ tuổi
- Các tính năng tạo nội dung người lớn mặc định bị tắt và phải được Người quản lý máy chủ chủ động bật.
- Người quản lý máy chủ bật các tính năng này xác nhận rằng họ từ 18 tuổi trở lên và nội dung sẽ chỉ giới hạn trong các kênh được Discord đánh dấu là giới hạn độ tuổi (age-restricted), nơi chỉ người lớn mới có quyền truy cập.
- Nội dung bị cấm bởi Nguyên tắc cộng đồng của Discord hoặc bởi pháp luật vẫn bị nghiêm cấm bất kể mọi cài đặt, đánh dấu kênh hay xác nhận độ tuổi.
- Chúng tôi có thể tắt các tính năng này đối với một Máy chủ, hoặc thu hồi quyền truy cập hoàn toàn, nếu phát hiện nội dung tiếp cận trẻ vị thành niên hoặc tạo ra nội dung bị cấm.

## 6) Nhà cung cấp và model của bên thứ ba
- Bạn có thể kết nối TomoriBot với các Nhà cung cấp bên ngoài (ví dụ: Anthropic, Google Gemini, OpenAI/OpenRouter, NovelAI, Brave Search). Các điều khoản, chính sách quyền riêng tư, bộ lọc an toàn và thanh toán của họ sẽ áp dụng cho bất kỳ nội dung nào bạn gửi qua họ.
- Việc chấp nhận các Điều khoản này chỉ áp dụng cho TomoriBot. Đây không phải là sự chấp thuận điều khoản của bất kỳ Nhà cung cấp nào và không miễn trừ trách nhiệm của bạn đối với các điều khoản đó. Hãy xem lại các điều khoản của Nhà cung cấp bạn đã chọn trước khi cấu hình với TomoriBot.
- TomoriBot không liên kết, không được xác nhận hoặc tài trợ bởi Discord hay bất kỳ Nhà cung cấp nào trong số này. Chúng tôi là một dịch vụ độc lập tích hợp với API của họ.
- Chúng tôi không thể kiểm soát hành vi, chính sách lưu giữ dữ liệu hoặc chính sách an toàn của các Nhà cung cấp đó.
- Nội dung do AI tạo ra có thể không chính xác, thiên vị hoặc không phù hợp dù đã có bộ lọc an toàn. TomoriBot không xác minh hay bảo đảm cho các kết quả đầu ra của AI.

## 7) Khóa API và thanh toán
- Nếu bạn cung cấp khóa API cho các nhà cung cấp AI/tìm kiếm, bạn ủy quyền cho TomoriBot lưu trữ và sử dụng chúng để thực hiện các yêu cầu của bạn. Tất cả các khóa được cung cấp đều được mã hóa khi lưu trữ.
- Bạn chỉ được cung cấp các khóa API mà bạn được ủy quyền sử dụng hợp pháp. Điều này có nghĩa là các khóa được lấy trực tiếp từ nhà cung cấp theo tài khoản của chính bạn, hoặc các khóa được chủ tài khoản ủy quyền rõ ràng cho bạn sử dụng. Những hành vi sau đây bị nghiêm cấm:
  - Khóa API bị đánh cắp, rò rỉ hoặc bị xâm phạm
  - Khóa mua từ các bên thứ ba trái phép hoặc thị trường chợ đen
  - Khóa được chia sẻ vi phạm điều khoản dịch vụ của nhà cung cấp
- Bạn chịu mọi trách nhiệm pháp lý về tính hợp pháp của các khóa API mà bạn cung cấp.
- Chúng tôi sẽ chỉ sử dụng khóa API của bạn để xử lý các tương tác trực tiếp của bạn với TomoriBot. Chúng tôi không gộp chung các khóa API, không sử dụng khóa của bạn để xử lý yêu cầu của người dùng khác, và không sử dụng chúng cho mục đích thử nghiệm, phát triển, phân tích hoặc bất kỳ mục đích nào khác ngoài việc thực hiện các yêu cầu trực tiếp của bạn và các thành viên trong máy chủ của bạn tới TomoriBot.
- Bạn chịu trách nhiệm về mọi chi phí phía nhà cung cấp và mức sử dụng tài khoản phát sinh từ mỗi lần Kích hoạt TomoriBot liên kết với khóa API của bạn. Hãy theo dõi bảng điều khiển khóa API của bạn để nắm được mức độ sử dụng và chi phí. Lệnh `/tool estimate cost` cung cấp ước tính sơ bộ về chi phí cho mỗi lần kích hoạt.
- Chúng tôi khuyên bạn nên sử dụng các khóa API có quyền hạn tối thiểu cần thiết, cũng như thiết lập giới hạn tần suất và hạn mức chi tiêu phía nhà cung cấp nếu có.

## 8) Xử lý dữ liệu
- Dữ liệu được thu thập, thời gian lưu giữ và mục đích sử dụng được mô tả trong [Chính sách quyền riêng tư](/vi/legal/privacy-policy/).
- Bạn có thể xuất hoặc xóa dữ liệu của mình bằng các lệnh được liệt kê trong tài liệu đó. Lệnh `/personal nuke` xóa dữ liệu cá nhân của bạn trên mọi Máy chủ; lệnh `/nuke` xóa dữ liệu của một Máy chủ và chỉ giới hạn cho Người quản lý máy chủ.
- Nội dung thuộc quyền sở hữu của Máy chủ, chẳng hạn như bộ nhớ Máy chủ và các tài liệu đã tải lên, vẫn tồn tại sau khi thực hiện xóa dữ liệu cá nhân nhưng thông tin tác giả của bạn sẽ bị gỡ bỏ. Hãy yêu cầu Người quản lý máy chủ xóa các mục cụ thể bằng lệnh `/memories`.
- Một số hồ sơ vận hành có thể được giữ lại trong thời gian lưu giữ đã nêu, hoặc lâu hơn nếu pháp luật yêu cầu hoặc vì lý do bảo mật.

## 9) Tính khả dụng, hỗ trợ và thay đổi
- Tính khả dụng của dịch vụ không được đảm bảo. Sự cố gián đoạn, bảo trì hoặc giới hạn tần suất có thể làm gián đoạn câu trả lời.
- Chúng tôi có thể cập nhật các Điều khoản này bất kỳ lúc nào. Những thay đổi quan trọng sẽ được thông báo trước ít nhất 30 ngày qua Discord hỗ trợ hoặc repository của dự án, và sẽ được thể hiện bằng việc cập nhật ngày "Cập nhật lần cuối". Việc tiếp tục sử dụng bot sau khi có thay đổi đồng nghĩa với việc bạn chấp nhận các Điều khoản đã sửa đổi.

## 10) Chấm dứt dịch vụ
- Chúng tôi có thể tạm ngừng hoặc thu hồi quyền truy cập đối với các trường hợp vi phạm các Điều khoản này, các yêu cầu pháp lý hoặc các lo ngại về an toàn/bảo mật.
- Bạn có thể xóa TomoriBot bất kỳ lúc nào. Hãy cân nhắc chạy lệnh `/nuke` trước khi xóa, vì nếu không dữ liệu của Máy chủ sẽ được giữ lại để cấu hình không bị mất khi mời lại bot.

## 11) Tuyên bố từ chối trách nhiệm và giới hạn trách nhiệm pháp lý
- Dịch vụ được cung cấp trên cơ sở "NGUYÊN TRẠNG" (AS IS) và "NHƯ HIỆN CÓ" (AS AVAILABLE) mà không có bất kỳ hình thức bảo đảm nào. Chúng tôi từ chối các bảo đảm ngụ ý về khả năng thương mại, sự phù hợp cho một mục đích cụ thể, tính không vi phạm và tính khả dụng không bị gián đoạn.
- Chúng tôi mã hóa thông tin xác thực khi lưu trữ, sử dụng TLS có xác thực chứng chỉ cho các kết nối cơ sở dữ liệu, và hạn chế quyền truy cập cơ sở dữ liệu chỉ dành cho môi trường thực thi của bot và các quản trị viên có quyền truy cập cơ sở hạ tầng. Không có hệ thống nào an toàn tuyệt đối, và chúng tôi không thể đảm bảo sự bảo vệ chống lại mọi mối đe dọa, xâm phạm hoặc truy cập trái phép.
- Trong phạm vi tối đa mà pháp luật cho phép, chúng tôi không chịu trách nhiệm đối với:
  - Các thiệt hại gián tiếp, ngẫu nhiên, do hậu quả hoặc mang tính trừng phạt
  - Hành động của các nhà cung cấp bên thứ ba hoặc của người dùng
  - Truy cập trái phép, hành vi trộm cắp, làm sai lệch hoặc mất mát bất kỳ dữ liệu nào do TomoriBot lưu trữ (bao gồm khóa API, bộ nhớ, persona và cấu hình)
  - Bất kỳ thiệt hại nào ngoại trừ trường hợp có sự cẩu thả nghiêm trọng hoặc hành vi sai trái cố ý từ phía chúng tôi
- Tổng trách nhiệm pháp lý của chúng tôi được giới hạn ở mức lớn hơn giữa (a) số tiền bạn đã thanh toán cho chúng tôi cho dịch vụ (thường là 0 USD; các khoản quyên góp tự nguyện không phải là khoản thanh toán cho dịch vụ) hoặc (b) tổng cộng 10 USD cho tất cả các khiếu nại.
- Bằng việc sử dụng dịch vụ TomoriBot có sẵn, bạn chấp nhận những rủi ro này. Nếu bạn cảm thấy không thoải mái với những rủi ro đó, hãy cân nhắc tự self-host TomoriBot từ repository mã nguồn mở, nơi bạn nắm toàn quyền kiểm soát việc lưu trữ dữ liệu, mã hóa và các biện pháp bảo mật.
- Không có điều nào trong các Điều khoản này giới hạn các quyền không thể bị giới hạn theo quy định pháp luật áp dụng cho bạn.

## 12) Báo cáo và liên hệ
- Đối với các câu hỏi, báo cáo lạm dụng, báo cáo bảo mật hoặc báo cáo rằng TomoriBot đang lưu giữ dữ liệu về người dưới độ tuổi tối thiểu theo quy định, vui lòng gửi email đến `bredrumb@gmail.com` hoặc liên hệ với chúng tôi trong [máy chủ Discord hỗ trợ chính thức của TomoriBot](https://discord.gg/bjCfHm9QsB).
- Vui lòng sử dụng email hoặc tin nhắn trực tiếp thay vì tạo issue công khai trên GitHub cho bất kỳ vấn đề nào liên quan đến dữ liệu cá nhân hoặc lỗ hổng bảo mật.
