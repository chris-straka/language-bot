# Discord Bot -> Ollama Language Tutor 

Setup mac m4 mini to run...  

```sh
ollama run qwen2.5:7b
>> Jakebot but teaches you
```

# Discord

Token .env
App ID 1469074638503153737
Public Key fb6da31886aa86ebf92be73ccfea2760cfe483a34e78a38f2efccf3fadaabdfa
Perm Int 72704

https://discord.com/oauth2/authorize?client_id=1469074638503153737&permissions=72704&integration_type=0&scope=bot

# References

Uses [ollama](https://github.com/ollama/ollama-js) with Qwen2.5
Detects languages with [ELD](https://github.com/nitotm/efficient-language-detector-js)
Uses [Discord bot library](https://github.com/discordjs/discord.js)
