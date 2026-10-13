---
title: "Bên trong prompt"
sidebar:
  order: 2
aiGenerated: false
---

Mỗi khi bạn kích hoạt TomoriBot, nội dung sau sẽ được tập hợp và gửi đến model văn bản đã định cấu hình của bạn dưới dạng lời nhắc/ngữ cảnh chính, theo thứ tự sau:

| Khối | Không bắt buộc? | Lệnh | Nó là gì |
|---|---|---|---|
| [Lời nhắc hệ thống](/vi/features/chatting-personality/behavior-tweaking/#system-prompt) |  | `/config` > Động cơ > Chung | Hướng dẫn cơ bản ở trên cùng của ngữ cảnh. |

> **Văn bản lời nhắc hệ thống mặc định**: chỉ được sử dụng khi không có lời nhắc hệ thống máy chủ nào được đặt. >
> *"Bạn là {bot}. Theo mặc định, {bot} đảm bảo trả lời ngắn gọn và chính xác. {bot} chỉ trả lời dài dòng nếu tình huống đó cho phép. >
> {{if tool:create_long_term_memory}}{bot} chủ động sử dụng {memory_tool} có sẵn bất cứ khi nào ai đó chia sẻ một chi tiết hoặc {bot} nhận thấy một chi tiết trong cuộc trò chuyện thực sự đáng ghi nhớ, chẳng hạn như sở thích, mối quan tâm hoặc một sự kiện quan trọng, thích ghi nhớ những điều ngay cả khi nó là chuyện nhỏ miễn là nó không trùng lặp với những gì {bot} đã biết. {{/if}}{{if tool:update_long_term_memory}}{bot} sử dụng {memory_update_tool} thay vì thông tin mới thay đổi hoặc thêm vào nội dung nào đó mà {bot} đã ghi nhớ, thay vì lưu bản sao.{{/if}} >
> {{if tool:review_capabilities}}Khi ai đó hỏi {bot} có thể làm gì hoặc tại sao nội dung nào đó không khả dụng, {bot} sẽ kiểm tra {capabilities_tool} trước khi trả lời. {{/if}}{{if tool_family:url_fetch}}Khi cần thêm thông tin chi tiết, {bot} sử dụng {url_fetch_tool} trên `https://docs.tomoribot.app/llms.txt` để biết thông tin.{{/if}}"*

| Khối | Không bắt buộc? | Yêu cầu | Nó là gì |
|---|---|---|---|
| Lời nhắc kênh (chắp thêm) | *(Không bắt buộc)* | `/config` > `Kênh` > Ghi đè kênh | Thay đổi theo từng kênh, được xếp lớp ngay sau lời nhắc hệ thống. Chế độ *thay thế* của cùng một trang sẽ tiếp quản vị trí lời nhắc hệ thống ở trên thay vì thêm một vị trí mới. |
| Lời nhắc về persona | *(Không bắt buộc)* | `/config` > `Persona` > Nâng cao | Lời nhắc được viết riêng cho persona đang hoạt động, tách biệt với lời nhắc của hệ thống. |
| [Thuộc tính cá nhân](/vi/features/chatting-personality/multiple-personas/#attributes) |  | `/config` > `Persona` > `Danh tính & Tính cách` | Đặc điểm tính cách và kiểu nói của người năng động. |
| Thông tin máy chủ |  | *(không có, từ Discord)* | Tên máy chủ, mô tả và kênh cô ấy đang truy cập được lấy từ chính Discord. |
| [Chặn người dùng cá nhân](/vi/features/capabilities/tools-and-extensions/#built-in-tools) | *(Không bắt buộc)* | `/moderation` để xem xét/xóa; được kiểm soát bởi `/config` > `Quyền hạn` (Chặn người dùng) | Các hạn chế tắt tiếng/chặn hiện hoạt mà tính cách này áp dụng đối với những người dùng cụ thể. |
| [Bộ nhớ máy chủ](/vi/features/knowledge/memory/#personal-vs-server-memories) |  | `/memories` | Các sự kiện dài hạn được lưu cho máy chủ này. |
| [Biểu tượng cảm xúc của máy chủ](/vi/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Không bắt buộc)* | `/config` > `Plugin` > `Bổ sung ngữ cảnh` (Biểu tượng cảm xúc trong thư trả lời) (chỉ chuyển đổi), khởi tạo bằng `/expressions initialize` | Biểu tượng cảm xúc tùy chỉnh có trong máy chủ. |
| [Hình dán máy chủ](/vi/features/chatting-personality/behavior-tweaking/#expressions) | *(Không bắt buộc)* | `/config` > `Plugin` > `Công cụ khả dụng` (`Sử dụng sticker`), phân loại nội dung gốc bằng `/expressions initialize`, quản lý bằng `/expressions manage` | Nhãn dán gốc có thể gửi và mọi biểu thức tùy chỉnh đủ điều kiện cho người phản hồi, kèm theo tên, mô tả và cảm xúc. Các nguồn phương tiện và quy tắc truy cập cá nhân nằm ngoài lời nhắc. |
| [Nhân vật Persona](/vi/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Không bắt buộc)* | `/config` > `Persona` > Linh hồn | Các họa tiết biểu thức được đặt tên được định cấu hình cho persona, nếu có. |
| [Người tham gia cuộc trò chuyện](/vi/features/knowledge/memory/#personal-vs-server-memories) | *(Không bắt buộc)* | `/personal memories` (được kiểm soát bởi `/config` > `Quyền hạn` (Cá nhân hóa)) | Những người trong cuộc trò chuyện, biệt danh và địa chỉ đề cập của họ cũng như những kỷ niệm cá nhân được lưu giữ về mỗi người trong số họ. Được tải khi người đó sở hữu một tin nhắn trong ngữ cảnh hoặc nếu tên/bí danh của họ được nhắc đến. Đồng thời mang kênh hiện tại và giờ địa phương dưới dạng chân trang, sử dụng `/config` > Engine > General. |
| [Bộ nhớ ngắn hạn](/vi/features/knowledge/memory/#short-term-memory-stm) |  | `/config` > `Persona` > Ký ức; `/memories` để xóa các mục; được kiểm soát bởi `/config` > `Quyền hạn` (Bộ nhớ ngắn hạn) | Chứa tóm tắt và tin nhắn gần đây của các kênh khác nhau |
| [`Tài liệu`](/vi/features/knowledge/memory/#document-knowledge-base-rag) | *(Không bắt buộc)* | `/memories` | Các phần có liên quan được lấy từ cơ sở kiến thức bằng RAG. |
| [Điều chỉnh hành vi](/vi/features/knowledge/memory/#conditioning) | *(Tùy chọn)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`; quản lý bằng `/conditioning remove` | Các tác động tích lũy lên hành vi của persona trong máy chủ này. |
| [Đoạn hội thoại mẫu](/vi/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Không bắt buộc)* | `/config` > `Persona` > `Danh tính & Tính cách` | Ví dụ về cách nói chuyện của persona này, nếu có, đã được định cấu hình. |
| [Tin nhắn gần đây](/vi/features/chatting-personality/behavior-tweaking/#generation-tuning) |  | `/config` > Động cơ > Chung | Cuộc trò chuyện thực tế, có tới nhiều tin nhắn (mặc định 80). Ghi chú ngữ cảnh của bạn và bất kỳ ghi chú đoàn tụ nào đều được đưa vào nội dòng bên trong khối này, ở độ sâu có thể định cấu hình, thay vì dưới dạng một khối riêng biệt. |

Các hàng được đánh dấu *(Tùy chọn)* không đóng góp gì (và không tốn mã thông báo) khi không có gì để nói, ví dụ: không có tài liệu nào khớp hoặc máy chủ không có biểu tượng cảm xúc tùy chỉnh.

Những tin nhắn gần đây là phần lớn nhất và dễ vỡ nhất, nó là một cửa sổ trượt về phía trước khi mọi người nói chuyện. Mọi thứ phía trên chúng đều được xây dựng lại từ các cài đặt đã lưu và ổn định.

`/tool prompt snapshot` đưa gói chính xác của một cá nhân vào một tệp. Đó là sự thật cơ bản mà ký ức hiện đang hoạt động, liệu tài liệu có trùng khớp hay không và mức độ thực sự phù hợp của cuộc trò chuyện.

`/context` vẽ cùng một gói dưới dạng lưới màu của cửa sổ ngữ cảnh của model, một màu cho mỗi nhóm khối ở trên, do đó bạn có thể xem nhanh những gì lấp đầy nó và còn lại bao nhiêu chỗ trống. Một vòng tròn đánh dấu một nhóm nhỏ hơn một hình vuông. Nó cũng hiển thị chi phí đầu vào ước tính cho mỗi câu trả lời và số lượng mã thông báo đầu vào mà nhà cung cấp đã báo cáo cho câu trả lời thực tế cuối cùng.

`/tool estimate cost` chia nhỏ gói tương tự theo kích thước, điều này rất hữu ích để tìm ra những gì đang ảnh hưởng đến bối cảnh của bạn trước khi bạn tăng bất kỳ giới hạn nào.

### Công cụ được định nghĩa ở đâu?

Đối với mọi nhà cung cấp mà TomoriBot hỗ trợ nguyên bản, các lược đồ công cụ sẽ được gửi qua trường `tools` của chính nhà cung cấp, do đó, điều này phụ thuộc vào công cụ suy luận được định cấu hình/nhà cung cấp.

### Tại sao TomoriBot quên?

Thứ tự này giải thích hầu hết mọi câu hỏi "tại sao cô ấy không nhớ?" câu hỏi:

| Chuyện gì đã xảy ra thế | Tại sao |
|---|---|
| Cô ấy đã quên một điều gì đó từ đầu ngày hôm nay | Nó đã vượt quá giới hạn tin nhắn. Nó chỉ có trong các tin nhắn Gần đây, nếu Tomori không lưu nó làm bộ nhớ dài hạn thì nó sẽ bị lãng quên khi ra ngoài cửa sổ tin nhắn. |
| Cô ấy quên cái gì đó ở kênh khác | Tin nhắn gần đây là trên mỗi kênh. Chỉ có bộ nhớ Máy chủ, Người tham gia cuộc hội thoại và các kênh chéo bộ nhớ ngắn hạn. Bộ nhớ ngắn hạn khắc phục điều này bằng cách tải các tin nhắn gần đây từ các kênh khác nhau, nhưng nó không loại bỏ mọi thứ. |
| `/refresh` khiến cô quên mất | Làm mới sẽ cắt các tin nhắn gần đây và xóa bộ nhớ ngắn hạn của kênh này nhưng không xóa bộ nhớ dài hạn. Xóa phần nhúng làm mới để loại bỏ phần giới hạn. |
| Cô ấy quên thứ gì đó sau khi khởi động lại | Tin nhắn gần đây không bao giờ tồn tại khi khởi động lại |

Nếu bạn muốn thứ gì đó tồn tại được sau tất cả những điều trên thì nó phải trở thành trí nhớ lâu dài. Xem [Bộ nhớ](/vi/features/knowledge/memory/#long-term-memory).

## Mẹo và thủ thuật

- `/config` > Engine > General mở rộng cửa sổ hội thoại (20-100 tin nhắn). Nhiều ngữ cảnh hơn đồng nghĩa với nhiều token hơn cho mỗi câu trả lời.
- `/config` > Engine > General chèn một lời nhắc ngắn ở độ sâu đã chọn. Vì nằm ở vị trí thấp trong gói ngữ cảnh, gần với các tin nhắn gần đây, bot sẽ có nhiều khả năng thực hiện theo lời nhắc đó hơn so với nội dung trong prompt hệ thống. Đây là nơi tốt nhất để nhắc bot lưu bộ nhớ thường xuyên hơn.
- `/personal memories` và `/memories` ghi trực tiếp vào `Bộ nhớ máy chủ` và Người tham gia cuộc trò chuyện, đây là một trong những cách đảm bảo để giữ tri thức vĩnh viễn trong ngữ cảnh của TomoriBot.
