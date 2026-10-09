---
title: "Bộ nhớ"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot có hệ thống bộ nhớ bền vững giúp bot nhớ các dữ kiện qua các cuộc trò chuyện. Trang này đề cập đến *những gì bot biết* (dữ kiện, ngữ cảnh, tài liệu). Về *cách bot ứng xử* (tính cách, giọng điệu), hãy xem [Nhiều persona](/vi/features/chatting-personality/multiple-personas/).

## Hệ thống cấp bậc bộ nhớ

Từ bền vững nhất đến dễ trôi qua nhất

| Cấp | Mô tả | Thời gian tồn tại |
|---|---|---|
| Bộ nhớ dài hạn (LTM) | Các dữ kiện đã lưu về người dùng hoặc máy chủ, tài liệu đã tải lên và điều hòa hành vi | Vĩnh viễn, cho đến khi có người xóa. Tồn tại qua `/refresh`, khởi động lại và mọi tình huống |
| Bộ nhớ ngắn hạn (STM) | Bản tóm tắt bot tự viết cho một kênh, kèm theo một vài tin nhắn gần đây | 24 giờ. Có thể tiếp cận xuyên kênh |
| Lịch sử trò chuyện | Các tin nhắn gần đây trong kênh mà bot đang phản hồi | Chỉ trong kênh này, chỉ cho đến khi cuộn ra ngoài phạm vi `/config` > Engine > General (mặc định là 80 tin nhắn mới nhất). `/refresh` sẽ cắt đứt ngay lập tức |

Hầu như mọi thứ bot có vẻ "biết" trong một cuộc trò chuyện chỉ là lịch sử trò chuyện gần đây, đó là lý do bot dường như quên một tin nhắn khi cuộc trò chuyện trở nên quá dài. Chỉ có bộ nhớ dài hạn là vĩnh viễn. STM nằm ở khoảng giữa: hữu ích để mang một diễn biến qua các kênh mà không cần lưu cố định, nhưng vẫn sẽ hết hạn.

Để xem chính xác những gì bot được cung cấp trong bất kỳ lượt tương tác nào, hãy xem [Bên trong prompt](/vi/features/knowledge/inside-the-prompt/).

## Bộ nhớ dài hạn
<!-- anchor: long-term-memory -->

Bộ nhớ dài hạn là thứ duy nhất bot lưu giữ vĩnh viễn. Chúng không bị ảnh hưởng bởi `/refresh`, bởi việc khởi động lại hay chuyển sang kênh khác.

### Bộ nhớ cá nhân và bộ nhớ máy chủ
<!-- anchor: personal-vs-server-memories -->

Có hai loại bộ nhớ dài hạn:

- Bộ nhớ cá nhân (`/personal memories`): các dữ kiện về từng người dùng cá nhân, ví dụ: "Amaori thích mèo", "thích giao diện tối hơn", "dị ứng với đậu phộng". Những thông tin này gắn liền với *bạn* và đi theo bạn qua mọi máy chủ, nhưng bot chỉ dùng đến chúng trong các cuộc trò chuyện mà bạn tham gia trực tiếp.
- Bộ nhớ máy chủ (`/memories`): thông tin liên quan đến toàn bộ máy chủ, ví dụ: "Đêm chơi game diễn ra vào thứ Sáu hàng tuần lúc 8 giờ tối", "không đăng nội dung NSFW", "#general dùng cho thông báo". Những thông tin này chỉ nằm trong máy chủ và luôn được lưu tâm tại đó.

Bộ nhớ được cô lập theo từng persona theo mặc định. Mỗi persona (bao gồm cả các alter) giữ một tập hợp bộ nhớ cá nhân và bộ nhớ máy chủ riêng biệt, vì vậy các persona khác nhau đồng nghĩa với việc bot không thể nhớ lại những gì persona khác đã học. Ngoại lệ duy nhất là bộ nhớ cá nhân được thêm từ trang Toàn cục trên `/personal memories`, khi đó sẽ áp dụng cho mọi persona riêng với bạn. Bộ nhớ máy chủ không có tùy chọn như vậy, tập hợp bộ nhớ máy chủ của mỗi persona luôn tách biệt, ngay cả trong cùng một máy chủ.

Sử dụng `/memories` để duyệt, thêm, chỉnh sửa, xóa hoặc chuyển bộ nhớ máy chủ vào cơ sở tri thức tài liệu. Lệnh `/personal memories` quản lý các dữ kiện gắn liền với bạn. Bộ nhớ tồn tại cho đến khi bạn xóa chúng.

Trong các máy chủ mới, quyền truy cập của thành viên không phải quản lý để tạo, chỉnh sửa hoặc xóa bộ nhớ máy chủ dùng chung bị tắt theo mặc định. Thành viên có quyền `Quản lý máy chủ` luôn giữ quyền truy cập, và người quản lý có thể cấp quyền cho các thành viên khác thông qua `/moderation` Quyền thành viên.

### Cách lưu bộ nhớ

Chính xác có hai cách để tạo một bộ nhớ dài hạn:

1. Bạn tự lưu bằng `/personal memories` hoặc `/memories`.
2. Bot tự lưu khi nhận thấy điều gì đó đáng lưu giữ.

Khi bot tự lưu một bộ nhớ, bot sẽ đăng một thông báo embed cho biết mình đã học được điều gì đó. Thông báo embed đó chính là sự xác nhận. Nếu bạn nói điều gì đó với bot và không có thông báo embed nào xuất hiện, nghĩa là chưa có gì được lưu: nội dung đó vẫn chỉ là lịch sử trò chuyện, vì vậy bot sẽ quên khi cuộc trò chuyện tiếp diễn và sẽ không có thông tin đó ở kênh khác.

Nếu bot không tự lưu những điều bạn muốn giữ lại, bạn có ba lựa chọn, theo mức độ tác động tăng dần:

- Yêu cầu trực tiếp bot nhớ điều đó.
- Thêm một lời nhắc bằng `/config` > Engine > General, hoặc bằng bất kỳ lệnh mang prompt nào khác từ [Bên trong prompt](/vi/features/knowledge/inside-the-prompt/) (`/config` > Persona > Nâng cao, `/config` > Engine > General, `/config` > Channels > Channel Overrides). Một ghi chú ngữ cảnh nói riêng nằm ở vị trí thấp trong prompt, giúp bot dễ thực hiện theo hơn. Một câu đơn giản như *"Khuyến khích tạo bộ nhớ dài hạn cho thông tin đáng nhớ"* thường là đủ. Để tham chiếu công cụ lưu bộ nhớ thực tế theo tên mà không cố định một giá trị có thể thay đổi theo nhà cung cấp, hãy sử dụng macro prompt `{memory_tool}` từ [công cụ tích hợp sẵn](/vi/features/capabilities/tools-and-extensions/#built-in-tools), ví dụ: *"Sử dụng {memory_tool} bất cứ khi nào..."*.
- Tự lưu bằng `/personal memories`, đây là phương pháp đảm bảo chắc chắn.

Quản trị viên máy chủ có thể tắt hoàn toàn tính năng tự lưu của bot bằng `/config` > Permissions.

### Số lượng bộ nhớ

Theo mặc định, bot lưu giữ tối đa 100 bộ nhớ cá nhân và 100 bộ nhớ máy chủ. Người tự host có thể thay đổi các giá trị này bằng các biến .env `MAX_PERSONAL_MEMORIES`, `MAX_SERVER_MEMORIES` và `MAX_MEMORY_LENGTH`. Việc tăng *độ dài* tốn nhiều ngữ cảnh hơn rất nhiều so với việc tăng *số lượng*, vì vậy nên ưu tiên nhiều bộ nhớ ngắn hơn là ít bộ nhớ dài.

Các giới hạn số lượng này được tính theo từng persona, không phải theo từng người dùng hay từng máy chủ. Mỗi persona giữ một tập hợp riêng, vì vậy một máy chủ chạy bốn persona sẽ có bốn định mức riêng biệt. Bộ nhớ cá nhân toàn cục của riêng bạn sẽ tính vào định mức cá nhân của từng persona.

### Cơ sở tri thức tài liệu (RAG)
<!-- anchor: document-knowledge-base-rag -->

Quản trị viên máy chủ có thể cung cấp tài liệu để bot tham khảo bằng RAG. Tài liệu được chia nhỏ và lưu dưới dạng các embedding có thể tìm kiếm; bot sẽ tự động truy xuất nội dung liên quan khi trả lời. Trong các máy chủ mới, việc quản lý tài liệu cũng được giới hạn cho các thành viên có quyền `Quản lý máy chủ` theo mặc định; người quản lý có thể cấp quyền cho thành viên thông qua `/moderation` Quyền thành viên.

Yêu cầu model embedding, được cấu hình bằng `/config` > Models > Switch Models. Xem [Nhà cung cấp và model](/vi/features/setup-administration/providers-and-models/). Trang Tài liệu trong `/memories` cung cấp phạm vi theo persona và toàn máy chủ, số lượng tài liệu và đoạn dữ liệu trực tiếp, tải lên, duyệt tài liệu và xóa:

- Tải lên tệp văn bản, PDF hoặc Markdown làm tri thức máy chủ. Phạm vi cho phép chọn gắn liền với chỉ persona này (mặc định) hay toàn máy chủ để mọi persona tham khảo.
- `/learn history`: trích xuất lịch sử kênh thành tri thức có thể tìm kiếm.
- Duyệt qua các tài liệu đã lưu theo từng đoạn. Quản trị viên máy chủ có thể chỉnh sửa từng đoạn riêng lẻ, cập nhật thẻ kênh của tài liệu, hoặc xóa một đoạn duy nhất mà không cần xóa toàn bộ tài liệu.
- Xóa các tài liệu đã lưu hoặc từng đoạn riêng lẻ trực tiếp từ bảng điều khiển.

#### Prompt nhập lịch sử

Khi nhập lịch sử kênh bằng `/learn history`, tùy chọn `prompt` sẽ thay đổi cách TomoriBot trích xuất bộ nhớ:

- Hội thoại trích xuất các dữ kiện độc lập từ cuộc trò chuyện thông thường. Chế độ này phân giải các đại từ và sử dụng mốc thời gian tuyệt đối khi ngày tháng hoặc thời gian được đề cập hoặc có thể suy luận được.
- Nhập vai tìm kiếm các phân cảnh, bối cảnh cốt truyện, mối quan hệ và sự kiện đáng nhớ mà không cố gắng lưu giữ từng chi tiết nhỏ.
- Đúng vai nhân vật trích xuất bộ nhớ từ góc nhìn của persona đã chọn, sử dụng prompt, thuộc tính, bộ nhớ hiện có và tài liệu liên quan của persona đó làm ngữ cảnh.

Prompt sẽ được hiển thị trước khi nhập để bạn có thể điều chỉnh cho phù hợp với kênh hoặc phân cảnh.

Dữ liệu lịch sử nhập vào được lưu dưới dạng tài liệu, vì vậy `/memories` cũng thao tác được trên chúng.

### Conditioning
<!-- anchor: conditioning -->

Lệnh `/conditioning` là bộ nhớ theo từng persona, từng máy chủ giúp định hướng hành vi của persona theo thời gian. Đây là một gợi ý nhẹ nhàng hơn so với một thuộc tính hoàn chỉnh hay prompt hệ thống. Hãy sử dụng tính năng này để củng cố cách một nhân vật cụ thể nên hành xử trong một máy chủ cụ thể.

Mỗi lượt `/reward` hoặc `/punish` đều được kiểm đếm, nhưng nó chỉ trở thành một bộ nhớ mà bot thực sự làm theo khi bạn cung cấp một `reason`, hiển thị như sau trong prompt của bot:

```text
## Rewarded Behaviors
Here are past things Tomori did that got rewarded for. Strive to do them again:
- [Tomori was fed by Amaori. Reason: `being extra helpful today` with `cookies`] (2 times)

## Punished Behaviors
Here are past things Tomori did that got punished for. Avoid doing them again:
- [Tomori was bonked by Amaori. Reason: `spamming pings after being told to stop`]
```

Nếu không có `reason`, lượt đếm vẫn được ghi lại nhưng không bao giờ xuất hiện trong prompt của bot. Xem lại hoặc xóa các mục bằng `/conditioning remove`.

## Kiểm soát thời điểm bộ nhớ kích hoạt

Phạm vi sẽ thu hẹp thông tin trước tiên: bộ nhớ máy chủ chỉ xuất hiện trong prompt thuộc máy chủ đó, bộ nhớ cá nhân chỉ xuất hiện khi người dùng đó hiện diện trong cuộc trò chuyện, và cả hai chỉ dành cho persona sở hữu chúng. Trong phạm vi đó, mọi bộ nhớ đều được gửi kèm trong mỗi prompt theo mặc định. Việc gắn thẻ giúp thu hẹp hơn nữa, để bộ nhớ chỉ kích hoạt theo từ khóa hoặc chỉ trong một kênh. Bật tính năng này bằng `/config` > Engine > Memory & STM.

### Thẻ từ khóa
<!-- anchor: keyword-tags -->

- Bộ nhớ không có thẻ từ khóa luôn luôn hoạt động (mặc định).
- Bộ nhớ có thẻ từ khóa chỉ kích hoạt khi từ khóa xuất hiện trong ngữ cảnh hiển thị.
- Sử dụng `/tool prompt snapshot` để xem những bộ nhớ nào hiện đang kích hoạt.

### Thẻ kênh

- Bộ nhớ có thẻ `#channel` chỉ kích hoạt trong kênh đó.
- Thẻ kênh có thể kết hợp với thẻ từ khóa.
- Nếu bạn sử dụng cơ sở tri thức tài liệu (RAG), thẻ kênh cũng áp dụng cho tài liệu và lịch sử đã trích xuất.

Trong `/help`, chọn `Bộ nhớ`, rồi chọn `Gắn thẻ bộ nhớ`, để xem bản tóm tắt tương tự trong Discord.

## Bộ nhớ ngắn hạn (STM)
<!-- anchor: short-term-memory-stm -->

TomoriBot có thể dễ dàng đọc các tin nhắn từ kênh hiện tại mà bot đang trò chuyện, nhưng STM cho phép bot thực hiện những điều sau mà không cần lưu thành bộ nhớ dài hạn thực sự:
1. Củng cố tạm thời kịch bản/tình huống hiện tại của kênh trong ngữ cảnh
2. Nhớ tạm thời các cuộc trò chuyện từ các kênh/máy chủ khác

Bot chỉ nhớ các cuộc trò chuyện mà mình đã tham gia. Bot cập nhật bộ nhớ của kênh khi phản hồi và không vào thời điểm nào khác, vì vậy một kênh bận rộn nhưng không ai nói chuyện với bot sẽ không để lại dấu vết nào.

STM của mỗi kênh sẽ hết hạn sau 24 giờ theo mặc định và nếu bạn đã từ chối tham gia bằng `/personal config`, tin nhắn của bạn cũng sẽ không bao giờ được đưa vào đó.

### Những gì bot có thể và không thể thấy

| Vị trí | Ý nghĩa |
|---|---|
| Trong máy chủ | Một bộ nhớ dùng chung cho mỗi kênh, không phải một bộ nhớ cho mỗi người. Bot không lưu ghi chú riêng về từng cá nhân bạn. |
| Trong DM | Của riêng bạn. |
| Kênh khác | Bot có thể nhớ lại các cuộc trò chuyện gần đây của mình từ một vài kênh khác trong cùng máy chủ. |
| Kênh riêng tư | Bất kỳ nội dung nào được thiết lập bằng `/config` > Channels > Channel Rules sẽ giữ nguyên tại đó và không xuất hiện ở nơi khác. |
| Máy chủ khác | Không bao giờ, trừ khi bạn bật `/personal config` → `crossserver`. Ngay cả khi đó, chỉ *các cuộc trò chuyện của chính bạn* mới đi theo bạn. |
| Mỗi persona | Giữ bộ nhớ riêng biệt, vì vậy chuyển đổi persona sẽ chuyển đổi bộ nhớ. |

Bộ nhớ của mỗi kênh lưu giữ một vài tin nhắn gần nhất cùng một bản tóm tắt ngắn do bot tự viết và làm mới khi cuộc trò chuyện tiếp diễn. Nó sẽ tự mờ dần sau vài giờ yên tĩnh.

### Lệnh

| Lệnh | Chức năng |
|---|---|
| `/config` > Persona > Memories | Xem bản tóm tắt bot đang lưu cho kênh này |
| `/config` > Persona > Memories | Chỉnh sửa hoặc tự bạn viết bản tóm tắt |
| `/personal config` / `/personal memories` | Chọn tham gia nhớ lại liên máy chủ, hoặc xóa dữ liệu của chính bạn |
| `/refresh` | Làm cho bot quên kênh này ngay lập tức |
| `/config` > Engine > Memory & STM | Tần suất bot cập nhật, và mức độ chi tiết bot lưu giữ |
| `/config` > Engine > Memory & STM | Hoán đổi bản tóm tắt lấy tối đa 5 trường có nhãn (*Bối cảnh hiện tại*, *Tâm trạng*, …) |
| `/config` > Engine > Memory & STM | Diễn đạt lại yêu cầu nhắc bot lưu giữ |
| `/memories` | Xem lại và xóa có chọn lọc các mục máy chủ đang hoạt động từ một bảng quản lý |
| `/config` > Permissions | Cho phép bộ nhớ kênh riêng tư xuất hiện ở nơi khác |
| `/config` > Permissions | Bật hoặc tắt tính năng (bộ nhớ đã lưu vẫn được giữ nguyên trong cả hai trường hợp) |

Bất kỳ ai cũng có thể chạy `/config` > Persona > Memories, `/personal config` và `/personal memories`. Các lệnh còn lại yêu cầu quyền Quản lý máy chủ.

### Cấu hình STM

Người quản lý không gian làm việc có thể tinh chỉnh bộ nhớ ngắn hạn từ `/config` → `Hành vi` → Memory & STM. Các cài đặt này áp dụng cho các bản ghi STM đang hoạt động của không gian làm việc:

- Nhịp làm mới kiểm soát số lượt tương tác của bot trôi qua giữa các lần nhắc làm mới. Phạm vi cho phép là 1-100.
- Chế độ hiển thị chọn xem các giá trị danh mục có thay thế các lượt gần đây hay xuất hiện dưới dạng tóm tắt thô.
- Tin nhắn thô kiểm soát số lượng tin nhắn gần đây được giữ lại, từ 1 đến mức tối đa của kênh.
- Độ sâu lời nhắc đặt vị trí lời nhắc làm mới tính từ cuối ngữ cảnh được tập hợp, từ 0-20.
- Độ sâu nội dung đặt vị trí nội dung STM tính từ cuối ngữ cảnh được tập hợp, từ −1-20.

Danh mục STM thay thế trường Tóm tắt mặc định bằng tối đa năm trường có nhãn. Nhập từng trường theo định dạng `Nhãn: Mô tả`; để trống mọi trường sẽ khôi phục danh mục Tóm tắt mặc định. Việc lưu danh mục sẽ xóa STM của các kênh máy chủ đang hoạt động không tương thích, và bảng điều khiển sẽ thông báo các kênh bị ảnh hưởng trước khi lưu.

Prompt STM cho phép người quản lý tùy chỉnh ưu tiên mô tả công cụ và lời nhắc cập nhật. Để trống các mục tùy chỉnh sẽ khôi phục các giá trị mặc định hiệu dụng, bao gồm lời nhắc nhận biết danh mục khi các danh mục được bật.

:::tip
Các lệnh STM này chỉ dành cho người dùng nâng cao, bạn nên giữ nguyên các cài đặt mặc định, trừ khi bạn muốn cho phép bot nhớ bạn qua các máy chủ bằng `/personal config`
:::

---

## Quyền riêng tư
Để biết chính xác những gì bot lưu trữ và cách xuất hoặc xóa dữ liệu đó, hãy xem [Xử lý dữ liệu](/vi/features/knowledge/data-handling/) và `/legal privacy-policy`. Bạn có thể chọn từ chối tham gia bộ nhớ hoàn toàn bằng `/personal config`.
