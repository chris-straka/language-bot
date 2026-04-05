import { Client, GatewayIntentBits, Partials } from 'discord.js';
import ollama from 'ollama';
import { eld } from 'eld/large';
import pinyin from 'pinyin';
import Kuroshiro from '@sglkc/kuroshiro';
import KuromojiAnalyzer from '@sglkc/kuroshiro-analyzer-kuromoji';
import languageMap from './lang.json';

const MODEL = 'qwen2.5:7b';
const MAX_LENGTH = 2000;
const URL_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;

/** Returns the language name from the emoji, or undefined if not mapped */
function getLanguage(flag: string): string | undefined {
  return (languageMap as Record<string, string>)[flag];
}

const clamp = (s: string) => s.length > MAX_LENGTH ? s.slice(0, MAX_LENGTH - 1) + '…' : s;

const cleanContent = (text: string) => {
  return text
    .replace(/<a?:.+?:\d+>/g, '') // Remove custom emojis
    .replace(/:[a-zA-Z0-9_~]+:/g, '') // Remove emoji names
    .trim();
};

const getPinyin = (text: string) => {
  return pinyin(text, { style: pinyin.STYLE_TONE })
    .map(item => item[0])
    .join(' ');
};

// --- KUROSHIRO SETUP (For Spaced Japanese Romaji) ---
const kuroshiro = new Kuroshiro();
let isKuroshiroReady = false;

kuroshiro.init(new KuromojiAnalyzer())
  .then(() => {
    isKuroshiroReady = true;
    console.log('Kuroshiro dictionary loaded! Romaji spacing is enabled.');
  })
  .catch((err) => console.error('Failed to load Kuroshiro:', err));

// --- CLIENT SETUP ---
const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials:[Partials.Message, Partials.Channel, Partials.Reaction],
});

// --- EVENT: MESSAGE CREATE (Auto-Detection & Mentions) ---
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const textToProcess = cleanContent(message.content);
  // Remove URLs and check for attachments (GIFs)
  const textWithoutUrls = textToProcess.replace(URL_REGEX, '').trim();
  
  // If the message is only a link, only a GIF, or empty after cleaning, ignore it
  if (!textWithoutUrls || (message.attachments.size > 0 && !textWithoutUrls)) return;

  // 1. Handle Mentions (Assistant Mode)
  const botMention = `<@${client.user?.id}>`;
  const botMentionNickname = `<@!${client.user?.id}>`;

  if (message.content.startsWith(botMention) || message.content.startsWith(botMentionNickname)) {
    const question = textWithoutUrls.replace(botMention, '').replace(botMentionNickname, '').trim();
    if (!question) return message.reply("Yes? How can I help?");

    await message.channel.sendTyping();
    try {
      const response = await ollama.chat({
        model: MODEL,
        messages:[
          { role: 'system', content: 'You are a helpful assistant. Provide concise and accurate answers.' },
          { role: 'user', content: question }
        ],
      });
      return message.reply(clamp(response.message.content));
    } catch (err) {
      console.error("Ollama Chat Error:", err);
      return message.reply("Sorry, I'm having trouble thinking right now.");
    }
  }

  // 2. Handle Auto-Detection (Translation to English)
  
  // Check if text contains CJK (Chinese, Japanese) characters.
  const isCJK = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(textWithoutUrls);

  if (isCJK) {
    if (textWithoutUrls.length < 3) return;
  } else {
    if (textWithoutUrls.length < 15 && textWithoutUrls.split(/\s+/).length < 3) return;
  }

  const result = eld.detect(textWithoutUrls);
  let langCode = result.language;

  if (langCode === 'nl' || langCode === 'en' || !result.isReliable()) return;

  if (langCode === 'zh' && /[\u3040-\u309F\u30A0-\u30FF]/.test(textWithoutUrls)) langCode = 'ja';

  try {
    await message.channel.sendTyping();
    const response = await ollama.chat({
      model: MODEL,
      messages:[
        { role: 'system', content: 'Translate to English. Output ONLY the translation text. No Pinyin, No Romaji.' },
        { role: 'user', content: textWithoutUrls }
      ],
      options: { temperature: 0.3 }
    });

    const translation = response.message.content.trim();
    let finalOutput = translation;

    if (langCode === 'zh') {
      finalOutput = `${translation}\nPinyin: ${getPinyin(textWithoutUrls)}`;
    }
    
    if (langCode === 'ja') {
      if (isKuroshiroReady) {
        const romaji = await kuroshiro.convert(textWithoutUrls, { mode: 'spaced', to: 'romaji' });
        finalOutput = `${translation}\nRomaji: ${romaji}`;
      } else {
        finalOutput = `${translation}\nRomaji: (Loading dictionary...)`;
      }
    }

    message.reply(clamp(finalOutput));
  } catch (err) {
    console.error("Auto-Translate Error:", err);
  }
});

// --- EVENT: REACTION ADD (Translate to Flag Language) ---
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  if (reaction.count && reaction.count > 1) return;

  const targetLang = getLanguage(reaction.emoji.name || '');
  if (!targetLang) return; 

  const textToTranslate = cleanContent(reaction.message.content || '')
    .replace(URL_REGEX, '')
    .trim();
    
  if (!textToTranslate || (reaction.message.attachments.size > 0 && !textToTranslate)) return;

  const channel = reaction.message.channel;
  if (channel.isTextBased() && 'sendTyping' in channel) await channel.sendTyping();

  try {
    const response = await ollama.chat({
      model: MODEL,
      messages:[
        { 
          role: 'system', 
          content: `Translate the text into ${targetLang}. Provide ONLY the translation. Do not include any IDs, tags, or emojis from the source.` 
        },
        { role: 'user', content: textToTranslate }
      ],
      options: { temperature: 0.3 }
    });

    const translation = response.message.content.trim();
    let finalOutput = translation;

    if (targetLang.includes('Chinese')) {
      finalOutput = `${translation}\n${getPinyin(translation)}`;
    } else if (targetLang === 'Japanese') {
      if (isKuroshiroReady) {
        const romaji = await kuroshiro.convert(translation, { mode: 'spaced', to: 'romaji' });
        finalOutput = `${translation}\n${romaji}`;
      } else {
        finalOutput = `${translation}\n(Loading dictionary...)`;
      }
    }

    const sentReply = await reaction.message.reply({
      content: clamp(finalOutput),
      allowedMentions: { repliedUser: false },
    });

    if (reaction.emoji.name) await sentReply.react(reaction.emoji.name);
  } catch (err) {
    console.error("Reaction Translation Error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);
console.log(`Bot started successfully using ${MODEL} on M4.`);