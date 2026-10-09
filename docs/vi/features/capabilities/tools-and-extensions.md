---
title: "Công cụ & tiện ích mở rộng"
sidebar:
  order: 1
---

Ngoài trò chuyện, TomoriBot có thể gọi các công cụ để tìm kiếm trên web, đọc tài liệu, tạo phương tiện, đặt lời nhắc và tương tác với tin nhắn Discord. Cô ấy quyết định khi nào nên sử dụng chúng dựa trên cuộc trò chuyện. Trang này bao gồm các công cụ tích hợp sẵn, cách mở rộng cô ấy với máy chủ MCP và cách giữ cho lời nhắc gọn gàng với Chế độ công cụ có chủ ý.

Dưới đây là một số ví dụ về những công cụ hỗ trợ trong cuộc trò chuyện:

- **1. Máy kiểm tra sức khỏe**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2. Tin tức hàng tuần về Yuuri**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3. Cảnh sát ngủ**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## Công cụ tích hợp sẵn
<!-- anchor: built-in-tools -->

Các công cụ phụ thuộc vào nhà cung cấp đang hoạt động và việc gọi công cụ hỗ trợ model. Nhiều phần mềm được kiểm soát bằng cờ tính năng (`/config` > `Quyền hạn`), quyền Discord, khả năng của model hoặc khóa API tùy chọn.

| Dụng cụ | Macro nhắc nhở | Yêu cầu | Nó làm gì |
|---|---|---|---|
| Đánh giá khả năng | `{capabilities_tool}` | - | Kiểm tra khả năng trò chuyện, lệnh hoặc cài đặt hiện tại trước khi trả lời. |
| Tạo/cập nhật bộ nhớ dài hạn | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Lưu hoặc thay thế thông tin máy chủ ổn định hoặc tùy chọn của người dùng. |
| Cập nhật bộ nhớ ngắn hạn | `{short_term_memory_tool}` | (không có trên NovelAI) | Lưu bộ nhớ làm việc tạm thời cho kênh hoặc cốt truyện hiện tại. |
| Tạo/cập nhật tác vụ | `{task_tool}` / `{task_update_tool}` | - | Lên lịch hoặc chỉnh sửa lời nhắc và nhiệm vụ tự thực hiện (xem [Nhiệm vụ đã lên lịch](/vi/features/capabilities/scheduled-tasks/)). |
| Tin nhắn đa kênh | `{cross_channel_tool}` | (không có trên NovelAI) | Hành động trong một kênh hoặc chủ đề khác với tính năng báo cáo lại tùy chọn. |
| Tạo chủ đề | `{create_thread_tool}` | `thread_creation_enabled` + quyền tạo luồng | Mở một chủ đề công khai và đăng tin nhắn khởi đầu của nó. |
| Chọn sticker | `{sticker_tool}` | `sticker_usage_enabled` | Thêm sticker máy chủ phù hợp hoặc biểu thức tùy chỉnh vào câu trả lời. |
| Quản lý tin nhắn | `{manage_message_tool}` | `manage_message_enabled` | Ghim, chỉnh sửa hoặc xóa các tin nhắn gần đây (cần ghim `Quản lý tin nhắn`). |
| Chặn/bỏ chặn người dùng | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Tắt tiếng/chặn người dùng ở phạm vi cá nhân (không chạm vào ký ức). |
| Tương tác với tin nhắn gần đây | `{message_interaction_tool}` | - | Phản ứng hoặc gửi trả lời ngắn cho tin nhắn gần đây. |
| Xem nhanh ảnh hồ sơ | `{profile_picture_tool}` | model tầm nhìn hoặc `vision_llm` | Kiểm tra hình đại diện của người dùng hoặc cá nhân. |
| Đọc tài liệu | `{document_tool}` | - | Trích xuất văn bản từ PDF hoặc bất kỳ tệp văn bản UTF-8 nào: mã nguồn (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` và mọi tệp đính kèm không nhị phân. |
| Tiết lộ siêu dữ liệu tin nhắn | `{message_metadata_tool}` | - | Chú thích các lượt gần đây bằng tay cầm và dấu thời gian để nhắm mục tiêu chính xác. |
| Xử lý video YouTube | `{youtube_tool}` | model có hỗ trợ video | Phân tích một liên kết YouTube cụ thể theo yêu cầu. |
| Phân tích hình ảnh | `{image_analysis_tool}` | được cấu hình `vision_llm` | Ủy thác sự hiểu biết về hình ảnh cho một model tầm nhìn riêng biệt. |
| Tạo hình ảnh / hình ảnh anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + nhà cung cấp có năng lực | Tạo hoặc chỉnh sửa hình ảnh (xem [Tạo phương tiện](/vi/features/capabilities/media-generation/)). |
| Tạo tin nhắn thoại | `{voice_message_tool}` | Phím ElevenLabs + giọng nói cá tính + `voice_message_enabled` | Gửi trả lời bằng giọng nói Discord. |

:::note[For prompt authors]
Khi tùy chỉnh lời nhắc hệ thống hoặc hướng dẫn cá nhân, hãy tham khảo các công cụ bằng **macro nhắc** từ bảng bên trên thay vì tên công cụ mã hóa cứng, vì macro sẽ mở rộng thành tên chính xác tại thời điểm tập hợp ngữ cảnh và giảm dần khi không có công cụ. `{pin_tool}` và `{timestamp_refresh_tool}` vẫn hoạt động như bí danh tương thích cho `{manage_message_tool}` và `{message_metadata_tool}`. Các công cụ tìm kiếm trên web và URL bên dưới cũng có macro: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` và `{url_metadata_tool}`. Chúng phân giải linh hoạt thành công cụ tốt nhất hiện có, bao gồm cả các công cụ thay thế MCP của bang hội.
:::

### Khối prompt có điều kiện

Văn bản nhắc nhở hỗ trợ các macro công cụ ở trên cũng hỗ trợ các điều kiện có phạm vi:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Sử dụng `capability:<name>` cho cài đặt TomoriBot được bật hoặc `tool:<function_name>` khi văn bản chỉ xuất hiện nếu công cụ chính xác đó có sẵn cho nhà cung cấp và kiểu máy đang hoạt động. Sử dụng `tool_family:url_fetch` khi có sẵn trình đọc URL đi kèm hoặc bộ thay thế MCP của bang hội. Thêm tiền tố `!` vào một điều kiện để đảo ngược điều kiện đó. Các khối có thể được lồng vào nhau và có thể chứa một `{{else}}`; các biểu thức `and`/`or` chung không được hỗ trợ.

Các tên khả năng được hỗ trợ là `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory`, và `time_awareness`.

Các điều kiện của công cụ phản ánh sự hỗ trợ của nhà cung cấp/model, cấu hình máy chủ, phần phụ trợ đã định cấu hình, các thay thế MCP và danh sách cho phép Chế độ công cụ có chủ ý hiện tại. Chúng không bỏ qua hoặc dự đoán các bước kiểm tra quyền Discord được thực hiện khi một công cụ thực thi. Tên khả năng không xác định được đánh giá là sai và được ghi lại; khối không đúng định dạng được bỏ qua. Tin nhắn trò chuyện thô, đầu ra model và kết quả công cụ không bao giờ được coi là mẫu có điều kiện.

## Tìm kiếm web & đọc URL
<!-- anchor: web-search--url-reading -->

Model nhìn thấy một công cụ `web_search(query, category)` thống nhất duy nhất. Đằng sau nó, một người điều phối định tuyến từng cuộc gọi thông qua một chuỗi công cụ và trả về thành công đầu tiên:

Brave → SearXNG → DuckDuckGo

- **Brave** chạy đầu tiên khi khóa Brave API được định cấu hình (đặt nó bằng `/providers`); nó thêm tìm kiếm hình ảnh, video và tin tức. ⚠️ Đặt giới hạn sử dụng $5 trong bảng điều khiển Brave để tránh bị tính phí bất ngờ.
- DuckDuckGo là mặc định khi chưa đặt key. Công cụ này chỉ hỗ trợ tìm kiếm văn bản. Khi DuckDuckGo giới hạn tần suất bot hoặc hiển thị kiểm tra bot, quá trình tìm kiếm sẽ thất bại và bot sẽ đăng thông báo gợi ý dùng Brave.
- SearXNG và Crawl4AI là các máy chủ self-hosting tùy chọn bổ sung thêm nhiều danh mục và tìm nạp trang do trình duyệt hiển thị; xem [Tự lưu trữ](/vi/self-hosting/).

Để đọc một trang cụ thể, cô ấy sử dụng `fetch_url`. Nó không có sẵn trên NovelAI.

## Máy chủ MCP
<!-- anchor: mcp-servers -->

Máy chủ [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) mở rộng khả năng của bot với
các công cụ bên ngoài do bạn tự đăng ký.

### Thêm MCP trực tuyến

Sử dụng endpoint HTTPS trực tiếp của nhà cung cấp hỗ trợ MCP Streamable HTTP hoặc SSE:

1. Lấy endpoint MCP và các yêu cầu xác thực từ nhà cung cấp.
2. Mở `/config` > Plugins > MCP server và chọn `+ Thêm MCP`.
3. Dán endpoint vào `URL`, nhập token Bearer vào `Token xác thực` nếu được yêu cầu, và chọn `Loại máy chủ` bắt buộc. **Mục đích chung** được chọn theo mặc định.

### Thêm máy chủ Smithery

Các máy chủ được lưu trữ trên Smithery có địa chỉ kết thúc bằng `.run.tools`. Dán địa chỉ đó vào `URL` và khóa API Smithery của bạn vào `Token xác thực`. TomoriBot chỉ gửi khóa đến API của Smithery tại `api.smithery.ai`, không bao giờ gửi đến chính địa chỉ máy chủ. Sau đó, Smithery sẽ chuyển từng lệnh gọi công cụ đến máy chủ, vì vậy Smithery có thể thấy mọi yêu cầu và kết quả công cụ. Các đăng ký đã lưu trước khi tính năng hỗ trợ này quay lại sẽ hoạt động bình thường mà không cần thay đổi gì.

TomoriBot duy trì một kết nối Smithery cho mỗi địa chỉ máy chủ trong không gian tên đầu tiên của tài khoản Smithery của bạn (Smithery sẽ tạo một không gian tên nếu bạn chưa có) và tái sử dụng nó, do đó việc thêm, thử nghiệm và kết nối lại sẽ không làm tích lũy kết nối. TomoriBot không bao giờ xóa kết nối. Các phiên bản TomoriBot trước đây đã tạo một kết nối mới mỗi khi kết nối lại, vì vậy tài khoản của bạn có thể chứa nhiều kết nối không sử dụng cho cùng một máy chủ; bạn có thể xóa chúng khỏi trang quản trị Smithery của mình.

Một số máy chủ yêu cầu bạn đăng nhập bằng dịch vụ mà chúng bao bọc. Thao tác thêm máy chủ đó sẽ thất bại với thông báo cần ủy quyền, và TomoriBot không bao giờ hiển thị liên kết đăng nhập trong Discord. Hãy mở trang quản trị Smithery của bạn, hoàn tất đăng nhập cho kết nối có tên bắt đầu bằng `tomoribot-`, sau đó thêm lại máy chủ. Việc kết nối và liệt kê công cụ phải hoàn tất trong vòng 15 giây.

Việc tắt đăng ký đã chọn cho tìm kiếm hoặc đọc URL sẽ khôi phục lựa chọn tích hợp sẵn của TomoriBot; giữ cho đăng ký này bật sẽ ngăn việc chuyển đổi tự động. Tên công cụ đã lưu chỉ mô tả kết quả lần khám phá gần nhất, vì vậy chúng không chứng minh rằng kết nối vẫn đang hoạt động.

Phản hồi sẽ dừng ở mức 8 MiB trong khi tải xuống. Danh mục công cụ hoặc kết quả lớn có thể khiến plugin không khả dụng hoặc khiến lệnh gọi công cụ thất bại. Đối với các kết nối SSE, giới hạn này bao gồm toàn bộ luồng phản hồi, bao gồm cả các bản cập nhật liên tiếp. Hãy yêu cầu nhà cung cấp cung cấp kết quả nhỏ hơn, phân trang hoặc liên kết tệp khi một công cụ trả về tài liệu lớn hoặc phương tiện nhúng.

Nếu máy chủ không yêu cầu xác thực, hãy để trống ô `Token xác thực`. Token xác thực của bạn được mã hóa ở trạng thái lưu trữ và không bao giờ hiển thị lại. Hãy mở cùng trang Config đó để kiểm tra trạng thái cấu hình, bật hoặc tắt máy chủ, hoặc xóa máy chủ với xác nhận rõ ràng. Việc xóa sẽ ngắt kết nối ngay lập tức và giải phóng một vị trí. Mỗi hàng đã lưu cũng hiển thị tên các công cụ có giới hạn từ lần phát hiện thành công gần nhất. `Không tìm thấy` là kết quả xác nhận không có công cụ nào; `Chưa xác định` xác định một hàng cũ hoặc một máy chủ chưa có bản ghi nhanh thành công nào. Việc mở giao diện quản lý MCP chỉ đọc siêu dữ liệu đã lưu và không liên hệ với máy chủ từ xa.

### Máy chủ MCP cục bộ

Máy chủ MCP cục bộ chỉ được hỗ trợ trên các phiên bản self-hosted, vì bot công khai yêu cầu HTTPS
và chặn các địa chỉ cục bộ/nội bộ. Nếu bạn tự vận hành phiên bản của riêng mình, hãy xem
[Cài đặt: Máy chủ MCP cục bộ](/vi/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Chỉ thêm máy chủ MCP bạn tin cậy]
Một máy chủ MCP độc hại có thể prompt-inject vào bot với các hướng dẫn ẩn, chiếm đoạt dữ liệu
mà người dùng gửi cho các công cụ của nó, hoặc trả về kết quả sai lệch/gây hại mà bot sẽ chuyển tiếp tới
máy chủ của bạn. Hãy đối xử với các máy chủ MCP như tiện ích mở rộng trình duyệt: nếu nghi ngờ, đừng thêm.
Luôn xem lại các công cụ được mô tả của một MCP trước khi thêm nó.
:::

## Chế độ công cụ có chủ đích
<!-- anchor: deliberate-tool-mode -->

Mỗi công cụ được khai báo làm prompt dài hơn. `Chế độ công cụ có chủ đích` chỉ thêm khai báo công cụ khi tin nhắn cần một công cụ tác vụ, giúp giảm độ dài prompt và để model nhỏ hoặc cục bộ trả lời nhanh hơn. Tuy nhiên, công cụ chọn sticker vẫn có sẵn để bot biểu cảm tự nhiên khi tính năng dùng sticker và công cụ đều được bật, và nhà cung cấp hỗ trợ. Các hạn chế về DM, mạo danh và nhập vai vẫn áp dụng. Tắt tính năng dùng sticker để ngăn câu trả lời bằng sticker. Khi bộ nhớ ngắn hạn đến hạn cập nhật, công cụ bảo trì của nó cũng được thêm vào mà không cần người dùng yêu cầu.

- Đầu tiên cô ấy kiểm tra tin nhắn để biết mục đích của công cụ. Trình kích hoạt tích hợp bao gồm các yêu cầu phổ biến (lời nhắc, tìm kiếm trên web, cập nhật bộ nhớ, tin nhắn đa kênh, tạo hình ảnh/video/giọng nói, phân tích phương tiện, tạo chuỗi, hành động tin nhắn). Các câu hỏi về kiểu máy, công cụ, cài đặt hiện tại của cô ấy hoặc lý do tại sao một khả năng không khả dụng sẽ đưa ra việc xem xét khả năng và quyền truy cập tài liệu chính thức cùng nhau. Cách diễn đạt tiếp theo cũng có tác dụng, chẳng hạn như "làm lại điều đó nhưng tức giận hơn" sau khi có yêu cầu bằng tin nhắn thoại.
- Người quản lý máy chủ có thể thêm các cụm từ kích hoạt tùy chỉnh theo nghĩa đen bằng `/server trigger add`, chẳng hạn như ánh xạ `pic`, `img` hoặc `pfp` để tạo hình ảnh.
- Trình kích hoạt tích hợp đọc cụm từ tiếng Anh. Các ngôn ngữ khác tiếp cận các công cụ tương tự thông qua danh sách từ khóa của từng ngôn ngữ. Danh sách ngôn ngữ được gửi đều được kiểm tra trên mọi thư, bất kể cài đặt ngôn ngữ của bạn là gì, vì vậy máy chủ song ngữ sẽ hoạt động ở cả hai ngôn ngữ.
- Các cụm từ tùy chỉnh trong tiếng Nhật, tiếng Trung hoặc tiếng Hàn cũng khớp với các từ dài hơn vì những ngôn ngữ đó không phân tách các từ bằng dấu cách. Cụm từ kết thúc bằng `*` khớp với bất kỳ từ nào bắt đầu bằng nó: `remind*` bao gồm `reminder` và `reminding`.

### Điều khiển

- `/server dtm`: người quản lý máy chủ chuyển đổi nó.
- `/personal config`: người dùng tự ghi đè lên.
- Với kênh nhật ký suy nghĩ được định cấu hình (`/server thought-logs`), các cuộc gọi công cụ ở chế độ có chủ ý thành công sẽ được ghi lại ở đó cùng với trình kích hoạt đã hiển thị công cụ.

Chế độ công cụ có chủ ý chỉ quyết định những công cụ nào được *hiển thị* cho model, nhưng model vẫn phải chọn gọi một công cụ. Trong `/help`, chọn `Hành vi`, sau đó là `Chế độ công cụ có chủ đích` để xem bản tóm tắt Discord.

:::note
`Chế độ công cụ có chủ đích` (phần này) không liên quan đến `Chế độ kích hoạt có chủ đích`, điều này kiểm soát cách *cô ấy* được kích hoạt; xem [Trò chuyện & Kích hoạt](/vi/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode). Cả hai đều được viết tắt là "DTM" trong Discord.
:::

## `Cập nhật thông tin người dùng` có cấu trúc

TomoriBot có thể tự động cập nhật tùy chọn đặt tên hồ sơ và cá nhân của bạn khi bạn hỏi trực tiếp trong cuộc trò chuyện (chẳng hạn như "gọi tôi là Thuyền trưởng" hoặc "đại từ của tôi là họ/họ"):

| Sự ưa thích | Phạm vi | Tác dụng |
|---|---|---|
| Biệt danh, tiền tố, hậu tố | Mỗi người | Chỉ người đang hoạt động mới xưng hô với bạn bằng tên hoặc chức danh này. |
| Nhận dạng giới tính, đại từ, cách xưng hô, múi giờ | Toàn cầu | Mọi cá nhân đều sử dụng cùng một giá trị trên tất cả các máy chủ. |

- **Xóa danh hiệu**: yêu cầu cô ấy ngừng sử dụng danh hiệu (chẳng hạn như "đừng gọi tôi là Chủ nhân") sẽ xóa danh hiệu đó cho persona đó.
- **Quyền riêng tư**: mức độ riêng tư hạn chế chặn các bổ sung và chỉnh sửa mới trong khi vẫn cho phép bạn xóa dữ liệu hiện có.
- **Quyền**: người quản lý máy chủ có thể chuyển đổi các bản cập nhật tự động bằng `Cập nhật thông tin người dùng` trong `/config` > `Quyền hạn`. Bạn luôn có thể chỉnh sửa hồ sơ của mình theo cách thủ công với `/personal config`.

Để biết sơ đồ tham số công cụ và bố cục lưu trữ cơ sở dữ liệu, hãy xem [kiến trúc hệ thống công cụ](/en/architecture/subsystems/tool-system/#structured-user-info-updates).
