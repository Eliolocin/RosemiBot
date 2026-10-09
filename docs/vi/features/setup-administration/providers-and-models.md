---
title: "Nhà cung cấp và model"
sidebar:
  order: 1
---

TomoriBot kết nối với các nhà cung cấp AI bên ngoài thay vì lưu trữ model tích hợp sẵn. Bạn có thể kết nối các dịch vụ được lưu trữ như Google Gemini, OpenRouter và NovelAI hoặc trỏ cô ấy đến các điểm cuối self-hosting cục bộ. Bạn cần ít nhất một nhà cung cấp để bắt đầu trò chuyện.

## API key
<!-- anchor: api-keys -->

Thêm khóa nhà cung cấp trong lần thiết lập đầu tiên với `/setup` hoặc sau này từ `/providers` bằng cách chọn `+ Add new Provider`. Khóa được mã hóa ở trạng thái lưu trữ nên không ai, kể cả quản trị viên máy chủ, có thể đọc lại chúng.

`/setup` hỏi làm thế nào các câu trả lời sẽ tiếp cận một model trước bất kỳ điều gì khác và câu trả lời sẽ quyết định những gì nó thu thập:

| Cách thức | Những gì nó thu thập |
|---|---|
| Nhà cung cấp AI (Được khuyến nghị) | Một nhà cung cấp từ danh mục cộng với khóa API của nó, được xác thực và mã hóa dưới dạng bản nháp. |
| Điểm cuối tùy chỉnh (Nâng cao) | Kết nối điểm cuối và một model văn bản, được đăng ký bên trong trình hướng dẫn. Xem [Điểm cuối tùy chỉnh](#custom-endpoints). |
| Người dùng BYOK (chỉ dành cho bang hội) | Không có gì: không gian làm việc không có nhà cung cấp riêng, vì vậy các thành viên phải cung cấp nhà cung cấp cá nhân. |

Không có gì được ghi vào cơ sở dữ liệu cho đến khi bạn nhấn `Hoàn tất thiết lập`. Trình hướng dẫn bị bỏ rơi hoặc đã hết hạn sẽ giữ nguyên các hàng nhà cung cấp hiện có của không gian làm việc. Để thay thế khóa hiện có, hãy sử dụng `/providers`, vì `/setup` sẽ không chạy trên không gian làm việc đã được định cấu hình.

Mỗi nhà cung cấp có các bước tạo khóa riêng. Trong `/help`, chọn `Thiết lập`, sau đó là `Lấy API key` và chọn nhà cung cấp của bạn để xem hướng dẫn từng bước hoặc sử dụng các điểm bắt đầu sau:

| nhà cung cấp | Ghi chú | Nhận chìa khóa |
|---|---|---|
| Google Song Tử | Cấp miễn phí, chạy mọi tính năng. Khuyến nghị thiết lập đầu tiên. | [AI Studio](https://aistudio.google.com/apikey) |
| OpenRouter | Một phím, nhiều mẫu (một số miễn phí). | [Phím OpenRouter](https://openrouter.ai/settings/keys) |
| NovelAI | Đăng ký; kể chuyện và nhập vai không bị kiểm duyệt (chỉ văn bản). | [NovelAI](https://novelai.net/) |
| tìm kiếm sâu | Model lý luận trả tiền khi bạn đi. | [Tìm sâu](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | Lưu trữ văn bản, nội dung nhúng và hình ảnh. | [Bản dựng NVIDIA](https://build.nvidia.com/) |
| nhân loại | Model Claude thông qua API (không phải Mã Claude). | [Nhân loại](https://console.anthropic.com/) |
| Z.ai | Gia đình GLM. ⚠️ ToS hạn chế sử dụng trong các tình huống mã hóa và tác nhân. | [Z.ai](https://z.ai/) |
| Vertex AI | Đám mây Google thông qua `gcloud` ADC (tốt nhất cho thiết lập nhà phát triển hoặc chạy cục bộ). | xem bên dưới |
| Vertex AI Express | Google Đám mây API-key BYOK (Xem trước, tập hợp con Gemini). | [Chế độ tốc hành](https://console.cloud.google.com/expressmode) |
| Phong tục | Bất kỳ điểm cuối tương thích OpenAI nào (Ollama, vLLM, LiteLLM,…). | xem [Điểm cuối tùy chỉnh](#custom-endpoints) |

:::caution
Không bao giờ chia sẻ khóa API của bạn với bất kỳ ai khác. Thêm hoặc thay thế mã thông báo xác thực Bearer của điểm cuối tùy chỉnh từ hành động `Sửa endpoint` của nó trong `/providers`.
:::

Vertex AI xác thực bằng Thông tin xác thực mặc định của ứng dụng (ADC) thay vì bí mật được lưu trữ. Đối với lưu trữ cục bộ, ADC có thể đến từ `gcloud`; triển khai được lưu trữ trên máy chủ nên sử dụng danh tính khối lượng công việc hoặc tài khoản dịch vụ. Chỉ riêng khóa AI Studio API không thể xác thực toàn bộ Vertex AI. Dự án Google Cloud đã chọn phải có tính năng thanh toán và bật Vertex AI API, đồng thời danh tính máy chủ cần có quyền truy cập Vertex. Hướng dẫn thiết lập có sẵn từ Google Vertex AI trên trang `API Keys` trong `/help`.

Thiết lập nhà cung cấp được Google hỗ trợ xác thực thông tin đăng nhập thông qua điểm cuối danh sách model được xác thực. Nó không tạo ra văn bản hoặc phụ thuộc vào bất kỳ model trò chuyện nào hiện được đánh dấu là mặc định của danh mục, do đó, model mặc định đã ngừng hoạt động không thể ngăn việc lưu thông tin xác thực hợp lệ.

### Tùy chọn: Key Brave Search

Brave Search tách biệt với nhà cung cấp AI của bạn và nâng cao khả năng tìm kiếm trên web bằng các kết quả hình ảnh, video và tin tức. Đặt nó trong `/providers`. ⚠️ Brave bao gồm tín dụng miễn phí $5/tháng, vì vậy hãy đặt giới hạn sử dụng $5 trong bảng điều khiển Brave để tránh các khoản phí không mong muốn.

## Chọn model

Sử dụng `/providers` để quản lý thông tin xác thực máy chủ, danh mục model và đăng ký điểm cuối. Sau đó, sử dụng `/config` > `Model` > Switch Models để chọn các nhiệm vụ khả năng chia sẻ mà mọi thành viên của máy chủ sử dụng. Cả hai lệnh đều yêu cầu quyền quản lý máy chủ.

Các thành viên cá nhân quản lý thông tin xác thực và danh mục của riêng họ bằng `/personal providers`, sau đó chọn các mẫu cá nhân trong `/personal config`. Cài đặt cá nhân tuân theo họ trên mọi máy chủ nơi họ sử dụng TomoriBot. Xem [Cá nhân hóa](/vi/features/knowledge/personalization/#your-own-providers) để biết thiết lập của người dùng.

Các bảng này có tiêu đề `Nhà cung cấp của máy chủ` và `Nhà cung cấp cá nhân` nên quyền sở hữu rõ ràng khi mở.

Trong `/config` > `Model` > `Chuyển đổi model`, bạn có thể chỉ định model và điểm cuối trên tám khe khả năng:

- **Văn bản**: model trò chuyện chính.
- **Tầm nhìn**: đọc hình ảnh khi model trò chuyện không thể đọc được.
- **Phần nhúng**: hỗ trợ [cơ sở kiến thức tài liệu](/vi/features/knowledge/memory/#document-knowledge-base-rag).
- **Hình ảnh tiêu chuẩn**: tạo hình ảnh tiêu chuẩn (xem [Tạo hình ảnh](/vi/features/capabilities/media-generation/image-generation/)).
- **Hình ảnh NovelAI**: Tạo hình ảnh NovelAI.
- **Video**: tạo video.
- **Điểm cuối TTS**: điểm cuối chuyển văn bản thành giọng nói.
- **Điểm cuối STT**: điểm cuối chuyển âm thanh từ giọng nói thành văn bản.

Sáu vị trí đầu tiên chọn bản ghi danh mục model. Thay vào đó, các khe TTS và STT chọn điểm cuối trong phạm vi không gian làm việc, kích hoạt điểm cuối đã chọn thay vì ghi cột model. Đăng ký và chỉnh sửa các điểm cuối đó trong `/providers`. `/personal config` giữ lại sáu khe định tuyến model cá nhân và không bao gồm bộ chọn điểm cuối TTS/STT cá nhân.

Bạn cũng có thể quản lý các khóa dự phòng để tự động chuyển đổi dự phòng và cân bằng tải trong `/providers`.

## Model quyết định
<!-- anchor: decision-models -->

Model quyết định là một danh mục riêng biệt trong `/providers` và `/personal providers`. Chúng trả lời các vị từ được định kiểu bằng xác suất. Việc đăng ký không làm thay đổi model trò chuyện đang hoạt động, không thiết lập hiệu chuẩn hoặc kích hoạt tính năng bỏ qua duyệt phản hồi. Các bảng điều khiển này vẫn chưa chọn một model quyết định.

OpenRouter là nhà cung cấp gốc được hỗ trợ. Hãy lưu khóa của nó, mở menu thả xuống model và chọn `+ Thêm một model quyết định`. Nhập ID từ danh mục Quyết định đã được xác minh của nó. Danh mục toàn cầu bao gồm `typesafe/jev-1.13`; các đăng ký bổ sung thuộc về máy chủ hoặc chủ sở hữu cá nhân của chúng. Tính năng khám phá gốc cung cấp giới hạn đầu vào và giá đã được ghi nhận. Danh mục trò chuyện không thể thiết lập hỗ trợ Quyết định.

Đối với dịch vụ tùy chỉnh, chọn `Thêm endpoint tùy chỉnh mới`, sau đó chọn `Tương thích System One` hoặc `Tương thích OpenAI Decisions` trong `Độ tương thích API`. Lưu URL cơ sở API và thông tin xác thực Bearer tùy chọn. Menu thả xuống model của nó cung cấp `+ Thêm một model quyết định` và kế thừa giao thức đó. Nhập ID model đã được ghi nhận và giới hạn token đầu vào (tối thiểu 512). Jev, Laya và Kev sử dụng khả năng tương thích System One. Các endpoint tương thích trò chuyện và gốc Ollama hiện có không cung cấp hành động này.

Nguồn gốc thuần túy được chuẩn hóa thành `/v1`. Các phiên bản rõ ràng và tiền tố gateway vẫn được giữ nguyên: `https://decision.example.invalid/gateway/v1` gọi `/gateway/v1/systemone` cho System One hoặc `/gateway/v1/decisions` cho OpenAI Decisions. Khả năng truy cập sử dụng `GET <stored-base>/models` mà không gửi dữ liệu cuộc trò chuyện; điều này không chứng nhận khả năng của model. Các model tùy chỉnh được đăng ký thủ công từ tài liệu dịch vụ của chúng khi tính năng khám phá không thể thiết lập siêu dữ liệu tính năng cần thiết.

Mở đăng ký Quyết định đã lưu để chỉnh sửa. Các chỉnh sửa tùy chỉnh bảo toàn chính xác danh tính model và endpoint của nó. Chọn `Xóa đăng ký quyết định này` trong `Thao tác đăng ký` để xóa nó trong khi vẫn giữ lại kết nối và thông tin xác thực. Việc xóa nhà cung cấp hoặc endpoint chính của nó sẽ xóa các đăng ký của chủ sở hữu đó. Các chủ sở hữu khác giữ lại các mục được chia sẻ. Danh sách model phân trang sau 18 đăng ký có thể chỉnh sửa bằng các điều khiển trang hiện có.

Đăng ký và thông tin xác thực của nhà cung cấp vẫn nằm ngoài việc xuất và nhập persona/cấu hình. Đặt lại cấu hình sẽ giữ nguyên các đăng ký đã lưu; việc xóa mục cha sẽ dọn dẹp chúng một cách rõ ràng.

## Endpoint tùy chỉnh
<!-- anchor: custom-endpoints -->

Điểm cuối tùy chỉnh cho phép bạn đăng ký các dịch vụ self-hosting hoặc hỗ trợ proxy (Ollama, LM Studio, LiteLLM, vLLM, ComfyUI, TTS/STT cục bộ) dưới dạng gói nhà cung cấp được gắn nhãn.

- **Phạm vi máy chủ**: mở `/providers` để đăng ký và chỉnh sửa điểm cuối không gian làm việc.
- **Phạm vi cá nhân**: mở `/personal providers` để xem danh mục mẫu cá nhân (xem [Cá nhân hóa](/vi/features/knowledge/personalization/#your-own-providers)). Điểm cuối lời nói cá nhân không được chọn từ `/personal config`.

Nhãn là tên menu giao diện người dùng và nhóm các khả năng trong một gói khi chúng chia sẻ một URL điểm cuối. Nó không bao giờ được gửi đến dịch vụ từ xa. Khả năng được phân phát từ các URL khác nhau cần có nhãn riêng biệt.

Để thêm điểm cuối tùy chỉnh:

1. Trong `/providers`, chọn `Add New Custom Endpoint`.
2. Chọn khả năng tương thích API và lưu kết nối. Việc lưu chuẩn bị các khả năng được giao thức đó hỗ trợ mà không cần đăng ký bất kỳ model nào.
3. Chọn điểm cuối mới và sử dụng model thả xuống của nó để đăng ký mã và khả năng chính xác của model. Việc thêm một model sẽ kích hoạt nó cho khả năng đó.
4. Sử dụng cùng một danh sách thả xuống để đính kèm nhiều model hơn hoặc chỉnh sửa các đăng ký hiện có. Các model văn bản khai báo các khả năng của chính chúng ở dạng đó và các model hình ảnh khai báo các chế độ yêu cầu mà chúng hỗ trợ.

Đối với TTS và STT, hãy đăng ký điểm cuối và các model của nó trong `/providers`, sau đó chọn và kích hoạt điểm cuối trong `/config` > `Model` > `Chuyển đổi model`. Các khe giọng nói đó chọn điểm cuối thay vì mục nhập danh mục model.

Khả năng tương thích của API xác định đường dẫn yêu cầu và tải trọng mà dịch vụ triển khai, do đó, nó cũng xác định khe cắm khả năng nào mà kết nối chuẩn bị. Việc đăng ký model chính xác cho các vị trí đó là một bước riêng biệt vì giao thức không thể được suy ra một cách đáng tin cậy chỉ từ URL điểm cuối.

Chế độ `Endpoint tùy chỉnh (Nâng cao)` của `/setup` thực hiện hai bước tương tự bên trong trình hướng dẫn: `Cấu hình kết nối` lưu khả năng tương thích, nhãn, URL và mã thông báo xác thực tùy chọn của API đằng sau kiểm tra khả năng tiếp cận và `Cấu hình model văn bản` đăng ký model văn bản chính xác và các khai báo khả năng của nó. Nút model vẫn bị tắt cho đến khi kết nối xác thực và việc lưu lại kết nối sẽ xóa phần khai báo model vì các phần khai báo phụ thuộc vào khả năng tương thích API. Trình hướng dẫn tạo các hàng kết nối, nhà cung cấp đã lưu, model và model hoạt động cùng nhau khi bạn nhấn `Hoàn tất thiết lập`. Trình hướng dẫn chỉ đăng ký các mẫu văn bản; Các khả năng hình ảnh, video, TTS và STT được đăng ký trong `/providers`.

OpenCode Go (`https://opencode.ai/zen/go/v1`) và OpenCode Zen (`https://opencode.ai/zen/v1`) hoạt động như các điểm cuối tùy chỉnh tương thích với OpenAI. TomoriBot gửi cho họ ID phiên cho mỗi cuộc trò chuyện mà họ yêu cầu, bắt nguồn từ hàm băm của kênh và cá nhân, vì vậy không có ID Discord nào rời khỏi bot.

Để biết hướng dẫn đầy đủ về cách chạy máy chủ cục bộ, hãy xem:

- [Thiết lập: LLM cục bộ](/vi/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Thiết lập: ComfyUI](/vi/self-hosting/local-endpoints/setup-comfyui/): tạo hình ảnh và video cục bộ.
- [Thiết lập: ChatMock](/vi/self-hosting/local-endpoints/setup-chatmock/): Tài khoản ChatGPT hoặc Codex CLI.

## Các nhà cung cấp được hỗ trợ
<!-- anchor: supported-providers -->

Nếu bạn không có phần cứng để lưu trữ các model của riêng mình, TomoriBot hỗ trợ nhiều dịch vụ đám mây. Không phải mọi tính năng đều có sẵn trên mọi nhà cung cấp.

### Nhà cung cấp LLM

| nhà cung cấp | Truyền phát | Gọi công cụ | Nhập hình ảnh | Nhúng | Ghi chú |
|---|---|---|---|---|---|
| Google Song Tử | ✅ | ✅ | ✅ | ✅ | Có sẵn các mẫu miễn phí |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | Có sẵn các mẫu miễn phí |
| Nhân loại (API) | ✅ | ✅ | ✅ | - | Không phải mã Claude |
| NovelAI | ✅ | ✅ | - | - | Chỉ GLM 4.6 mới có thể sử dụng công cụ |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | Có sẵn các mẫu miễn phí |
| tìm kiếm sâu | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | Model miễn phí; ⚠️ ToS = chỉ sử dụng mã hóa và tác nhân |
| Mã hóa Z.ai | ✅ | ✅ | - | - | Gói đăng ký |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | Bao gồm phiên bản Express 'miễn phí' |
| Codex CLI (thông qua ChatMock) | ✅ | ✅ | ✅ | - | [Thiết lập](/vi/self-hosting/local-endpoints/setup-chatmock/) |

### Tạo hình ảnh

| nhà cung cấp | Chuyển văn bản thành hình ảnh | Chuyển hình ảnh thành hình ảnh | Sơn trong | Ghi chú |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | Có thể kết hợp với các nhà cung cấp khác |
| NVIDIA | ✅ | - | - | Chỉ chuyển văn bản thành hình ảnh; hình ảnh tham khảo bị bỏ qua |
| Z.ai | ✅ | - | - | - |

Đây là các giá trị mặc định mà model hình ảnh của nhà cung cấp bắt đầu từ đó. NovelAI chạy qua đường dẫn riêng của nó chứ không phải bảng này. Đăng ký model hình ảnh thông qua `/providers` cho phép bạn khai báo các chế độ riêng của model đó, đó là cách bạn kích hoạt tính năng inpainting trên quy trình công việc ComfyUI hoặc trên model nhà cung cấp có API hỗ trợ chỉnh sửa ẩn. Một model bạn không bao giờ khai báo sẽ tiếp tục tuân theo các giá trị mặc định ở trên. Chỉ khai báo những gì model hỗ trợ: TomoriBot chỉ cung cấp các công cụ cho các chế độ bạn chọn và các chế độ không được hỗ trợ sẽ không thành công tại thời điểm tạo.

### Tạo video

| nhà cung cấp | Chuyển văn bản thành video | Chuyển hình ảnh thành video | Ghi chú |
|---|---|---|---|
| Google | ✅ | ✅ | Quy trình bỏ phiếu không đồng bộ |
| OpenRouter | ✅ | ✅ | Quy trình bỏ phiếu không đồng bộ |
| Z.ai | ✅ | ✅ | Quy trình bỏ phiếu không đồng bộ |

### Giọng nói và âm thanh

| nhà cung cấp | Chuyển văn bản thành giọng nói | Chuyển giọng nói thành văn bản |
|---|---|---|
| ElevenLabs | ✅ | ✅ |

Công cụ giọng nói cục bộ được đề cập trong [Tự lưu trữ](/vi/self-hosting/). Để biết tính năng tìm kiếm trên web và đọc URL tích hợp, hãy xem [Công cụ & tiện ích mở rộng](/vi/features/capabilities/tools-and-extensions/#web-search--url-reading).
