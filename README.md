### English | [日本語](.github/README_ja.md) | [繁體中文](.github/README_zh-TW.md) | [简体中文](.github/README_zh-CN.md) | [Español](.github/README_es-419.md) | [Português (Brasil)](.github/README_pt-BR.md) | [Tiếng Việt](.github/README_vi.md)

<!-- Language switcher slots for the language-expansion target locales.
     Each entry joins the switcher row above when its translated README lands as
     .github/README_<code>.md. Entries stay unlinked until then so the repository front page never
     carries a broken link. Labels are the endonyms from src/constants/docsLocales.ts.
     Planned: fr Français | ru Русский | ko 한국어
     See docs/en/contributing/localization/docs-site.md. -->

> [!NOTE]
> This README is a quick overview. For the full, up-to-date documentation (setup guides, feature walkthroughs, provider info, and more) visit **[docs.tomoribot.app](https://docs.tomoribot.app/)**.

<br />
<div align="center">

  <a href="https://github.com/Bredrumb/TomoriBot">
    <img src="assets/img/icons/tomoricon.svg" alt="Logo" width="80" height="80">
  </a>

<h3 align="center">TomoriBot</h3>

A self-hosted and customizable personal AI assistant/role-playing system for Discord with memory, multiple personas, tool calling, multimodality, and API/local model support.

<p align="center">
  <strong><a href="https://tomoribot.app/">Official Website</a></strong>
  &middot;
  <strong><a href="https://discord.com/oauth2/authorize?client_id=841644102059556915">Invite TomoriBot</a></strong>
  &middot;
  <strong><a href="https://discord.gg/bjCfHm9QsB">Discord Server</a></strong>
  <br />
  <a href="https://github.com/Bredrumb/TomoriBot/releases">Latest Releases</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=bug-report.md">Report Bug</a>
  &middot;
  <a href="https://github.com/Bredrumb/TomoriBot/issues/new?template=feature-request.md">Request Feature</a>
  <br />
  <br />

[![GitHub Stars](https://img.shields.io/github/stars/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/pulls)
[![License](https://img.shields.io/github/license/Bredrumb/TomoriBot.svg)](https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE)


  </p>

  




<!-- PROJECT LOGO -->
![TomoriBot Banner](assets/img/tomobanner.png)
[![Bun][Bun.sh]][Bun-url][![Discord.js][Discord.js]][Discord-url][![TypeScript][TypeScript.js]][TypeScript-url][![PostgreSQL][PostgreSQL.org]][PostgreSQL-url]

  
</div>

<!-- ABOUT THE PROJECT -->
## About the Project

TomoriBot is a free and open-source self-hosted personal AI assistant and role-playing system for Discord, inspired by SillyTavern and Discord's discontinued Clyde. It can be used as a practical assistant, customizable companion, and role-play partner for yourself in DMs, or for everyone in your Discord server. 

TomoriBot supports long-term memory, multi-persona behavior, web and MCP tools, in-chat media generation, Discord slash commands, and multiple providers including custom proxies and self-hosting your own models for everything from text generation to video generation.

### Getting Started

You can [invite the public TomoriBot](https://discord.com/oauth2/authorize?client_id=841644102059556915) to your Discord server, or [self-host your own instance](#self-hosting) if you prefer full control over your privacy and API keys. TomoriBot uses best security practices and encryption that keeps data safe, but self-hosting ensures that all data remain entirely on your device. 

After adding her to your server through either method above, run the `/setup` command for instructions. Then you can simply say her name (or @ mention her) in order to get a response. 

## Feature Showcase


![Screenshots 1](assets/img/scs/1.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/capabilities/tools-and-extensions/">Agentic AI-Powered Conversation</a></h3>
<p align="center">TomoriBot has LOTS of tools that allows her to go beyond just chatting, such as searching the web, setting recurrent tasks/reminders, utilizing your server's emotes/stickers, and memory options such as RAG and STM that allow her to remember context across channels and servers. </p>

<br />


![Screenshots 3](assets/img/scs/3.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/chatting-personality/multiple-personas/">Multi-Persona Support</a></h3>
<p align="center">TomoriBot's in-server personality, behavior, and avatar can be easily changed, created, as well as exported for others as Personas (akin to shareable AI Character Cards). Import and even transform your favorite SillyTavern cards through <code>/persona generate</code>. You can have an unlimited amount of different personas in a single server, each having their own memories and agendas. You can also orchestrate them to work with each other to do work in your server (or just mess around with each other).</p>

<br />

![Screenshots 2](assets/img/scs/2.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/capabilities/media-generation/">Complete Multimodal Input/Output</a></h3>
<p align="center">TomoriBot can process images, audio, and video sent       
  directly in Discord and generate them in return using your own local model endpoints or through API keys, all of which are encrypted inside a persistent database. Ready-to-use ComfyUI workflows can be found in <code>assets/comfyui-workflows/</code> and local audio inference servers in <code>servers/</code>!</p>

<br />


![Fully local setup with ComfyUI](assets/img/docs/intro/05-fully-local-setup.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/self-hosting/local-endpoints/">Fully Local Setup</a></h3>
<p align="center">You can run TomoriBot and its database on your own PC, with a local LLM for conversations, ComfyUI for image generation, and local speech models for voice generation and transcription. All of that AI processing can happen on your hardware without cloud AI providers. Discord still needs an internet connection and carries the messages and media you exchange with the bot.</p>

<br />

![Screenshots 4](assets/img/scs/4.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/command-reference/">Native Slash Commands for Configuration</a></h3>
<p align="center">Everything can be managed through Discord's native slash commands and interactive UI. Completely manage personas, prompts, tweak model parameters, set up MCP tool servers, adjust permissions, configure memory, set server member rate limits, and much more! You can also ask TomoriBot directly on what she can do and what her slash commands are. Currently, a Web Dashboard is in the works for even easier management.</p>

<br />

![Screenshots 5](assets/img/scs/5.png)
<h3 align="center"><a href="https://docs.tomoribot.app/en/features/">Lots of More Features, and Counting!</a></h3>
<p align="center">A bunch of fun features that are easy to setup ranging from practical automatic greetings for new server members and cross-channel movement, to silly ones like user impersonations for some trolling. New ones are constantly in development, so please report through GitHub issues or the official Discord for any bugs (or to share any fun suggestions).</p>

## Useful Resources

- [Full List of Supported Providers](https://docs.tomoribot.app/en/features/setup-administration/providers-and-models/#supported-providers)
- [How to run Local Models](https://docs.tomoribot.app/en/self-hosting/local-endpoints/)
- [Security & Threat Models](https://docs.tomoribot.app/en/wiki/threat-models/)
- [Official TomoriBot Roadmap](https://github.com/users/Bredrumb/projects/1/views/1)
- [Tool Macros for Prompt Customization](https://docs.tomoribot.app/en/features/capabilities/tools-and-extensions/)

<!-- GETTING STARTED -->
## Self-Hosting

See the [self-hosting documentation](https://docs.tomoribot.app/en/self-hosting/) for setup instructions,
Docker Compose, and optional local servers.

<!-- AFTER SETUP -->
### After Inviting / Setup

#### Basic Commands

- `/setup` - Initial bot setup for your server
- `/config` - Multiple ways to tweak TomoriBot
- `/personal memories` - Manage your personal memories
- `/memories` - Manage server memories, documents, and short-term memory
- `/moderation` - Manage member access, user blacklist, channel, persona, and role restrictions

See the full **[Command Reference](https://docs.tomoribot.app/en/features/command-reference/)** for every slash command.

#### Chat Interaction

Simply mention the bot in a server or use the configured trigger words to start a conversation:
```
@TomoriBot yo wassup
```

Or slide into TomoriBot's DMs and say hi!

## Acknowledgements

Huge thanks to everyone, especially to the following lovely people for their code contributions and advice that shaped TomoriBot to what it is today!

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/Bredrumb" title="Bredrumb: Creator, maintainer, and code contributions">
        <img src="https://avatars.githubusercontent.com/u/65227425?s=128" width="64" height="64" alt="Bredrumb: Creator, maintainer, and code contributions"><br>
        Bredrumb
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/palinalif" title="palinalif: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/31247276?s=128" width="64" height="64" alt="palinalif: Code contributions"><br>
        palinalif
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/baetican" title="baetican: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/280696164?s=128" width="64" height="64" alt="baetican: Code contributions"><br>
        baetican
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/struffl" title="struffl: Software design and technical guidance">
        <img src="https://avatars.githubusercontent.com/u/1026348?s=128" width="64" height="64" alt="struffl: Software design and technical guidance"><br>
        struffl
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/Rhapsody-Sky" title="Rhapsody-Sky: Software design and technical guidance">
        <img src="https://avatars.githubusercontent.com/u/8095300?s=128" width="64" height="64" alt="Rhapsody-Sky: Software design and technical guidance"><br>
        Rhapsody-Sky
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/aph31" title="aph31: Code contributions">
        <img src="https://avatars.githubusercontent.com/u/251111747?s=128" width="64" height="64" alt="aph31: Code contributions"><br>
        aph31
      </a>
    </td>
  </tr>
</table>

<!-- CONTACT -->
## Contact & Links

**Official Website**: [https://tomoribot.app](https://tomoribot.app/)

**Email**: bredrumb@gmail.com

**Discord**: [Official Support Server](https://discord.gg/bjCfHm9QsB)


## License
This project is licensed under [AGPLv3](LICENSE).

If you find TomoriBot helpful and want to support its ongoing development, consider leaving a ⭐ on GitHub or supporting via Ko-fi!

<p align="left">

  &nbsp;
  <a href="https://ko-fi.com/bredrumb">
    <img src="https://img.shields.io/badge/Support_on_Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Support on Ko-fi">
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
