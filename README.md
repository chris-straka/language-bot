# [Discord Bot -> Ollama Language Tutor]()

Setup mac m4 mini to run...  

```sh
ollama run qwen2.5:7b
bun ./index.ts
```

Similar to [Jakebot](https://jakebot.co.uk/) but runs locally and teaches you languages.

```sh
# Run it in the background with...
screen -r bot

bun ./index.ts
# ctrl + a 
# d
```

## [Discord Link](https://discord.com/oauth2/authorize?client_id=1469074638503153737&permissions=72704&integration_type=0&scope=bot)

Uses [ollama](https://github.com/ollama/ollama-js) with Qwen2.5
Detects languages with [ELD](https://github.com/nitotm/efficient-language-detector-js)
Uses [Discord bot library](https://github.com/discordjs/discord.js)
