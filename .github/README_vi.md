### [English](../README.md) | [日本語](README_ja.md) | [繁體中文](README_zh-TW.md) | [简体中文](README_zh-CN.md) | [Español](README_es-419.md) | [Português (Brasil)](README_pt-BR.md) | Tiếng Việt

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> README này là bản tổng quan nhanh. Để xem tài liệu đầy đủ và mới nhất (hướng dẫn cài đặt, giới thiệu tính năng chi tiết, thông tin nhà cung cấp và nhiều nội dung khác), hãy truy cập **[docs.tomoribot.app](https://docs.tomoribot.app/vi/)**.

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="../assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

Một trợ lý AI cá nhân và hệ thống nhập vai (role-playing) self-hosting có thể tùy chỉnh dành cho Discord với bộ nhớ, nhiều persona, gọi công cụ, đa phương thức cùng khả năng hỗ trợ API và model cục bộ.

<p align="center">
  <strong><a href="https://tomoribot.app/">Trang web chính thức</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Mời TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Máy chủ Discord</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Bản phát hành mới nhất</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Báo lỗi</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Yêu cầu tính năng</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](../assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
## Về dự án

TomoriBot là một trợ lý AI cá nhân và hệ thống nhập vai mã nguồn mở miễn phí, self-hosting dành cho Discord, lấy cảm hứng từ SillyTavern và Clyde đã ngừng hoạt động của Discord. Bot có thể được dùng làm trợ lý thực tế, người bạn đồng hành có thể tùy chỉnh và bạn diễn nhập vai cho riêng bạn trong tin nhắn trực tiếp (DM), hoặc cho mọi người trong máy chủ Discord của bạn.

TomoriBot hỗ trợ bộ nhớ dài hạn, hành vi nhiều persona, các công cụ web và MCP, tạo nội dung đa phương tiện ngay trong cuộc trò chuyện, hơn 200 lệnh slash Discord và nhiều nhà cung cấp bao gồm các proxy tùy chỉnh cũng như self-hosting model của riêng bạn cho mọi tác vụ từ tạo văn bản đến tạo video.

### Bắt đầu

Bạn có thể [mời TomoriBot công khai](https://discord.com/oauth2/authorize?client_id=841644102059556915) vào máy chủ Discord của bạn, hoặc [self-host phiên bản của riêng bạn](#self-hosting) nếu muốn toàn quyền kiểm soát quyền riêng tư và các API key của mình. TomoriBot áp dụng các biện pháp bảo mật tốt nhất và mã hóa để giữ dữ liệu an toàn, nhưng self-hosting đảm bảo rằng mọi dữ liệu hoàn toàn nằm trên thiết bị của bạn.

Sau khi thêm bot vào máy chủ của bạn bằng một trong hai cách trên, hãy chạy lệnh `/setup` để xem hướng dẫn. Sau đó, bạn chỉ cần gọi tên bot (hoặc @ đề cập bot) để nhận phản hồi.

## Giới thiệu tính năng


![Screenshots 1](../assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/capabilities/tools-and-extensions/">Trò chuyện với AI dạng tác tử (Agentic AI)</a></h3>
<p align="center">TomoriBot sở hữu RẤT NHIỀU công cụ cho phép bot vượt xa việc trò chuyện thông thường, chẳng hạn như tìm kiếm trên web, thiết lập các tác vụ/lời nhắc định kỳ, tận dụng emote/sticker của máy chủ, cùng các tùy chọn bộ nhớ như RAG và STM giúp bot ghi nhớ ngữ cảnh xuyên suốt các kênh và máy chủ. </p>

<br />


![Screenshots 2](../assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/capabilities/media-generation/">Đầu vào/Đầu ra đa phương thức hoàn chỉnh</a></h3>
<p align="center">TomoriBot có thể xử lý hình ảnh, âm thanh và video được gửi trực tiếp trong Discord cũng như tạo lại chúng bằng các endpoint model cục bộ của riêng bạn hoặc thông qua các API key, tất cả đều được mã hóa bên trong cơ sở dữ liệu bền vững. Các quy trình (workflow) ComfyUI có sẵn để sử dụng trong <code>assets/comfyui-workflows/</code> và các máy chủ suy luận âm thanh cục bộ trong <code>servers/</code>!</p>

<br />

![Screenshots 3](../assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/chatting-personality/multiple-personas/">Hỗ trợ nhiều persona</a></h3>
<p align="center">Tính cách, hành vi và ảnh đại diện trong máy chủ của TomoriBot có thể dễ dàng thay đổi, tạo mới cũng như xuất cho người khác dưới dạng Persona (tương tự như các thẻ nhân vật AI có thể chia sẻ). Nhập và thậm chí biến đổi các thẻ SillyTavern yêu thích của bạn thông qua <code>/persona generate</code>. Bạn có thể sở hữu số lượng không giới hạn các persona khác nhau trong một máy chủ duy nhất, mỗi persona có bộ nhớ và mục tiêu riêng. Bạn cũng có thể điều phối chúng phối hợp cùng nhau để thực hiện công việc trong máy chủ (hoặc đơn giản là trêu chọc lẫn nhau).</p>

<br />


![Screenshots 4](../assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/command-reference/">Hơn 200 lệnh gốc để cấu hình</a></h3>
<p align="center">Mọi thứ đều có thể được quản lý thông qua các lệnh slash gốc của Discord và giao diện người dùng (UI) tương tác. Quản lý hoàn toàn các persona, prompt, tinh chỉnh tham số model, thiết lập máy chủ công cụ MCP, điều chỉnh quyền hạn, cấu hình bộ nhớ, đặt giới hạn tần suất cho thành viên máy chủ và nhiều hơn nữa! Bạn cũng có thể hỏi trực tiếp TomoriBot về những việc bot có thể làm và các lệnh slash của bot. Hiện tại, một Web Dashboard đang được phát triển để giúp việc quản lý thuận tiện hơn nữa.</p>

<br />


![Screenshots 6](../assets/img/scs/6.png)

<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/integrations/sillytavern-support/">Tích hợp SillyTavern (Beta)</a></h3>
<p align="center">Sử dụng các preset SillyTavern yêu thích của bạn trực tiếp trong Discord thông qua TomoriBot để điều chỉnh toàn bộ prompt của bot, chỉ cần thả tệp .json vào thông qua <code>st-preset</code>. Nhóm hộp kiểm gốc mới của Discord dành cho các modal giúp bạn dễ dàng bật tắt các nút như trong SillyTavern. Bạn cũng có thể nhập trực tiếp các thẻ nhân vật SillyTavern thông qua <code>/persona import</code> hoặc chỉnh sửa chúng trước bằng <code>/persona generate</code>.</p>

![Screenshots 5](../assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/vi/features/">Nhiều tính năng hơn nữa, và còn tiếp tục tăng!</a></h3>
<p align="center">Hàng loạt tính năng thú vị và dễ cài đặt, từ những tính năng thực tế như tự động chào mừng thành viên mới của máy chủ và di chuyển xuyên kênh, cho đến những tính năng hài hước như giả mạo người dùng để trêu đùa. Các tính năng mới liên tục được phát triển, vì vậy vui lòng báo cáo qua GitHub issues hoặc Discord chính thức nếu gặp bất kỳ lỗi nào (hoặc để chia sẻ những đề xuất thú vị).</p>

## Tài nguyên hữu ích

- [Danh sách đầy đủ các nhà cung cấp được hỗ trợ](https://docs.tomoribot.app/vi/features/setup-administration/providers-and-models/#các-nhà-cung-cấp-được-hỗ-trợ)
- [Cách chạy các model cục bộ](https://docs.tomoribot.app/vi/self-hosting/local-endpoints/)
- [Bảo mật & mô hình mối đe dọa](https://docs.tomoribot.app/en/wiki/threat-models/)
- [Lộ trình phát triển chính thức của TomoriBot](https://github.com/users/Bredrumb/projects/1/views/1)
- [Macro công cụ để tùy chỉnh prompt](https://docs.tomoribot.app/vi/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## Self-Hosting

Chọn một phương thức cài đặt:

- **A. Cài đặt Bun cục bộ (Khuyến nghị):** yêu cầu Bun và PostgreSQL hoặc Docker cho cơ sở dữ liệu.
- **B. Cài đặt Docker Compose:** chỉ yêu cầu Docker để chạy bot/cơ sở dữ liệu, nhưng các tập lệnh bảo trì phía máy chủ host vẫn cần các công cụ trên host.

Phương thức được khuyến nghị cho hầu hết người dùng self-hosting là trình hướng dẫn cài đặt Bun cục bộ. Quy trình **Full Install** mặc định của nó sẽ tạo `.env`, tạo một `CRYPTO_SECRET` an toàn, yêu cầu token bot Discord của bạn, cấu hình PostgreSQL, chạy `bun install --frozen-lockfile`, sau đó thử cài đặt cơ sở dữ liệu gọn nhẹ và các tiện ích hỗ trợ AI bổ sung.

### A. Cài đặt Bun cục bộ

1. **Clone kho lưu trữ**
   ```sh
   git clone https://github.com/Bredrumb/TomoriBot.git
   cd TomoriBot
   ```

2. **Chạy trình hướng dẫn cài đặt** (xem thêm thông tin tại **[Hướng dẫn về trình hướng dẫn cài đặt](https://docs.tomoribot.app/vi/self-hosting/setup-wizard/)**)
   ```sh
   bun run setup
   ```

3. **Khởi động TomoriBot**
    ```sh
    bun run dev
    ```

Khi bạn thấy thông báo `TomoriBot up and running!`, hãy chạy lệnh `/setup` trong Discord.

### B. Cài đặt Docker Compose

Docker Compose sẽ build và chạy TomoriBot cùng với PostgreSQL. Phương thức này không sử dụng trình hướng dẫn cài đặt.

**Các biến `.env` bắt buộc cho Docker Compose:**
- `DISCORD_TOKEN` - Token bot Discord của bạn
- `CRYPTO_SECRET` - Khóa mã hóa 32 ký tự
- `POSTGRES_PASSWORD` - Mật khẩu cơ sở dữ liệu (các cài đặt DB khác được tự động cấu hình)

Đối với Docker Compose, hãy bắt đầu từ `.env.example`, sau đó thêm `POSTGRES_PASSWORD` nếu bạn chưa thiết lập. Các giá trị tùy chọn để tinh chỉnh Docker hoặc runtime vẫn có thể được sao chép từ `.env.optional.example`.

```sh
# Build và khởi động TomoriBot cùng cơ sở dữ liệu
docker compose up --build
```

Đối với những lần khởi động sau, chỉ cần `docker compose up` là đủ trừ khi bạn đã thay đổi mã nguồn hoặc các phần phụ thuộc (dependencies).

### C. Máy chủ cục bộ tùy chọn

TomoriBot hỗ trợ các máy chủ cục bộ tùy chọn đi kèm với một trong hai phương thức cài đặt để tăng cường công cụ và bổ sung giám sát cục bộ: SearXNG để tìm kiếm web, Crawl4AI để thu thập trang web được render bằng trình duyệt, và các máy chủ giọng nói TTS/STT cục bộ.

**Với bản cài đặt Bun cục bộ (A)**, sử dụng `bun run launch` thay vì `bun run dev`, các ví dụ chạy:

```sh
# Với các container Docker SearXNG và Crawl4AI
bun run launch --searxng --crawl4ai

# Với một máy chủ TTS cục bộ sau khi làm theo tài liệu hướng dẫn cài đặt giọng nói
bun run launch --qwen3tts
bun run launch --voxcpm2
bun run launch --cosyvoice3

# Xem tất cả các cờ có sẵn
bun run launch --help
```

Các cờ có sẵn: `--searxng`, `--crawl4ai`, `--qwen3tts`, `--chatterbox`, `--irodoritts`, `--voxcpm2`, `--fishs2`, `--cosyvoice3`, `--moss`, `--whisperx`, `--help`

**Ctrl+C** sẽ dừng bot và mọi tiến trình máy chủ Python. Các container Docker (`--searxng`, `--crawl4ai`) được chủ ý giữ tiếp tục chạy, hãy dừng chúng thủ công bằng lệnh `docker stop searxng` / `docker stop crawl4ai` khi bạn hoàn tất.

**Với Docker Compose (B)**, các máy chủ cục bộ là tùy chọn thông qua các profile trong Compose:

```sh
# + Tìm kiếm web SearXNG (công cụ siêu tìm kiếm self-hosting)
docker compose --profile searxng up

# + Thu thập trang web render bằng trình duyệt Crawl4AI
docker compose --profile fetch-crawl4ai up

# + Cả hai cùng lúc
docker compose --profile searxng --profile fetch-crawl4ai up
```

Xem các hướng dẫn bên dưới để biết chi tiết cài đặt đầy đủ:

- **[Tìm kiếm web SearXNG](https://docs.tomoribot.app/vi/self-hosting/local-endpoints/setup-searxng/)** - Phiên bản siêu tìm kiếm self-hosting để vượt qua giới hạn API của một công cụ tìm kiếm đơn lẻ cho công cụ `web_search`.
- **[Crawl4AI](https://docs.tomoribot.app/vi/self-hosting/local-endpoints/setup-crawl4ai/)** - Máy chủ render bằng trình duyệt để tải và xử lý các trang web nặng JavaScript cho công cụ `fetch_url`.
- **[Chuyển văn bản thành giọng nói (Text-to-Speech)](https://docs.tomoribot.app/vi/self-hosting/local-endpoints/text-to-speech/)** / **[Chuyển giọng nói thành văn bản (Speech-to-Text)](https://docs.tomoribot.app/vi/self-hosting/local-endpoints/speech-to-text/)** - Các máy chủ giọng nói Python cho tin nhắn thoại của TomoriBot; môi trường ảo (venv) của chúng cần được thiết lập một lần từ trước.

### Cập nhật TomoriBot

Để cập nhật phiên bản self-hosting của bạn lên bản mới nhất, trước tiên hãy dừng bot (để việc sao lưu và mọi migration chạy trên cơ sở dữ liệu không có hoạt động), sau đó chạy trình cập nhật ưu tiên sao lưu:

```sh
bun run update
```

Lệnh này sẽ chạy trình tự sau, dừng ngay lập tức nếu có bất kỳ bước nào thất bại:

1. **`bun run backup`** - sao lưu toàn bộ cơ sở dữ liệu vào `/backups/` *trước khi* chạm vào bất kỳ mã nguồn nào. Nếu việc sao lưu thất bại, quá trình cập nhật sẽ hủy bỏ và giữ nguyên trạng bản triển khai của bạn.
2. **`git pull --rebase --autostash`**
3. **`bun install --frozen-lockfile`**

Sau đó khởi động lại TomoriBot bằng `bun run dev` hoặc `bun run launch`

Các cờ hữu ích:

| Cờ | Tác dụng |
|---|---|
| `--build` | Đồng thời chạy `bun run build` sau khi cài đặt các phần phụ thuộc |
| `--docker` | Quy trình Docker Compose: thay thế bước 3 bằng `docker compose build` + `docker compose up -d` |
| `--skip-backup` | Bỏ qua bước sao lưu trước khi cập nhật (không khuyến nghị) |
| `--yes` | Bỏ qua bước xác nhận trước khi bắt đầu |

Xem toàn bộ **[Tài liệu bảo trì](https://docs.tomoribot.app/vi/features/command-reference/)** để biết thêm chi tiết về tất cả các tập lệnh phía máy chủ host.

<!-- AFTER SETUP -->
### Sau khi mời / cài đặt

#### Các lệnh cơ bản

- `/setup` - Thiết lập bot ban đầu cho máy chủ của bạn
- `/config` - Nhiều cách để tùy chỉnh TomoriBot
- `/personal memories` - Quản lý bộ nhớ cá nhân của bạn
- `/memories` - Quản lý bộ nhớ máy chủ, tài liệu và bộ nhớ ngắn hạn
- `/moderation` - Quản lý quyền truy cập của thành viên, danh sách đen người dùng, các hạn chế về kênh, persona và vai trò

Xem đầy đủ **[Danh mục lệnh](https://docs.tomoribot.app/vi/features/command-reference/)** để biết mọi lệnh slash.

#### Tương tác trò chuyện

Chỉ cần đề cập bot trong một máy chủ hoặc sử dụng các từ kích hoạt đã cấu hình để bắt đầu cuộc trò chuyện:
```
@TomoriBot yo wassup
```

Hoặc nhắn tin trực tiếp (DM) cho TomoriBot và nói lời chào!

<!-- CONTRIBUTING -->
## Đóng góp

Mọi đóng góp cho TomoriBot đều được đánh giá rất cao! Vui lòng xem lại các tài nguyên sau trước khi mở một pull request:

- **[Tài liệu đóng góp](https://docs.tomoribot.app/en/contributing/)**: Hướng dẫn từng bước toàn diện để thêm các lệnh slash, công cụ, trình xử lý sự kiện (event handler), nhà cung cấp AI mới và ngôn ngữ mới.
- **[Hướng dẫn đóng góp](CONTRIBUTING.md)**: Các quy tắc của kho lưu trữ bao gồm việc tạo nhánh, kiểm tra cổng chất lượng (quality gate) và phạm vi đóng góp được hoan nghênh mà không cần thảo luận trước.

<!-- LEGAL -->
## Pháp lý & giấy phép

### Dành cho người dùng bản TomoriBot chính thức được lưu trữ
- **[Điều khoản dịch vụ](https://docs.tomoribot.app/vi/legal/terms-of-service/)** - Các quy tắc và hướng dẫn khi sử dụng bot
- **[Chính sách bảo mật](https://docs.tomoribot.app/vi/legal/privacy-policy/)** - Cách chúng tôi xử lý dữ liệu của bạn

Bạn cũng có thể truy cập các tài liệu này ngay trong Discord bằng các lệnh `/legal terms-of-service` và `/legal privacy-policy`.

### Dành cho người dùng self-hosting hoặc sử dụng bản fork
Bạn kiểm soát dữ liệu của chính mình và chịu trách nhiệm về tính tuân thủ của bản triển khai theo giấy phép [**GNU Affero General Public License v3.0**](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE).

<!-- CONTACT -->
## Liên hệ & liên kết

**Trang web chính thức**: [https://tomoribot.app](https://tomoribot.app/)

**Liên kết dự án**: [https://github.com/Bredrumb/TomoriBot](https://github.com/Bredrumb/TomoriBot)

**Email**: bredrumb@gmail.com

**Discord**: [Máy chủ hỗ trợ chính thức](https://discord.gg/bjCfHm9QsB)

<!-- SUPPORT -->
## Ủng hộ dự án

Nếu bạn thấy TomoriBot hữu ích và muốn hỗ trợ sự phát triển liên tục của dự án, hãy cân nhắc để lại một ⭐ trên GitHub hoặc ủng hộ qua Ko-fi!

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ủng hộ trên Ko-fi">
  </a>
</p>

<!-- MARKDOWN LINKS & IMAGES -->
[TypeScript.js]: https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Bun.sh]: https://img.shields.io/badge/Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white
[Bun-url]: https://bun.sh/
[Discord.js]: https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[PostgreSQL.org]: https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Google.ai]: https://img.shields.io/badge/Google%20AI-4285F4?style=for-the-badge&logo=google&logoColor=white
[Google-url]: https://ai.google.dev/
