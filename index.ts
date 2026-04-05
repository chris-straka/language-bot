import { Client, GatewayIntentBits, Partials, TextChannel, ThreadChannel, ChannelType } from 'discord.js';
import ollama from 'ollama';
import pinyin from 'pinyin';

// --- CONFIGURATION ---
const THREAD_NAME = '中文'; 
const MODEL = 'qwen2.5:7b';
const MAX_LENGTH = 2000;
const URL_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;

// Maps Thread Message IDs to Main Channel Message IDs to link replies
const replyMap = new Map<string, string>();

const clamp = (s: string) => s.length > MAX_LENGTH ? s.slice(0, MAX_LENGTH - 1) + '…' : s;

const cleanContent = (text: string) => {
  return text
    .replace(/<a?:.+?:\d+>/g, '') // Remove Discord custom emojis
    .replace(/:[a-zA-Z0-9_~]+:/g, '') // Remove Discord emoji text tags
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '') // Remove Native Unicode emojis
    .replace(/[\u200B-\u200D\uFEFF\uFE0F]/g, '') // Remove invisible Zero-Width Joiners and Variation Selectors
    .trim();
};

const getPinyin = (text: string) => {
  return pinyin(text, { style: pinyin.STYLE_TONE }).map(item => item[0]).join(' ');
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const textToProcess = cleanContent(message.content);
  const textWithoutUrls = textToProcess.replace(URL_REGEX, '').trim();
  
  if (!textWithoutUrls || (message.attachments.size > 0 && !textWithoutUrls)) return;

  // --- 1. MIRROR CHANNEL TO ITS '中文' THREAD ---
  if (message.channel.type === ChannelType.GuildText) {
    const mainChannel = message.channel as TextChannel;
    
    // Check if this is a reply and get the parent author's name
    let replyText = "";
    if (message.reference?.messageId) {
      try {
        const parentMsg = await mainChannel.messages.fetch(message.reference.messageId);
        replyText = ` (replying to **${parentMsg.author.displayName}**)`;
      } catch (err) { /* ignore if parent message is deleted */ }
    }
    
    let studyThread = mainChannel.threads.cache.find(t => t.name === THREAD_NAME) as ThreadChannel | undefined;
    if (!studyThread) {
      const active = await mainChannel.threads.fetchActive();
      studyThread = active.threads.find(t => t.name === THREAD_NAME) as ThreadChannel | undefined;
    }
    if (!studyThread) {
      studyThread = await mainChannel.threads.create({ name: THREAD_NAME, reason: 'Study bot setup' }) as ThreadChannel;
    }
    if (studyThread.archived) await studyThread.setArchived(false);

    try {
      const response = await ollama.chat({
        model: MODEL,
        messages: [
          { 
            role: 'system', 
            content: 'You are a translator. Translate the following English conversational text into natural, informal Simplified Chinese. Output ONLY the Chinese characters. No English, no explanations.' 
          }, 
          { role: 'user', content: textWithoutUrls }
        ],
      });
      
      const translation = response.message.content.trim();

      // If the AI just echoed the English back, ignore it
      if (!/[\u4E00-\u9FFF]/.test(translation)) return;

      const py = getPinyin(translation);
      
      const threadMsg = await studyThread.send(`**${message.author.displayName}**${replyText}: ${translation}\n> ${py}\n||${textWithoutUrls}||`);
      
      if (replyMap.size > 2000) replyMap.delete(replyMap.keys().next().value!);
      replyMap.set(threadMsg.id, message.id);
    } catch (err) { console.error("Mirror Error:", err); }
    return;
  }

  // --- 2. THREAD INPUT (Chinese Only + Reverse Proxy) ---
  if (message.channel.isThread() && message.channel.name === THREAD_NAME) {
    const parentChannel = message.channel.parent as TextChannel;
    if (!parentChannel) return;

    if (!/[\u4E00-\u9FFF]/.test(textWithoutUrls)) {
      await message.delete();
      return; 
    }

    try {
      const toEnglish = await ollama.chat({
        model: MODEL,
        messages: [
          { 
            role: 'system', 
            content: 'Translate the following Chinese into natural English for a chat room. Output ONLY the English translation.' 
          }, 
          { role: 'user', content: textWithoutUrls }
        ],
      });

      const englishOut = toEnglish.message.content.trim();
      const py = getPinyin(textWithoutUrls);

      let originalMsgId = message.reference?.messageId ? replyMap.get(message.reference.messageId) : null;

      if (originalMsgId) {
        try {
          const originalMsg = await parentChannel.messages.fetch(originalMsgId);
          await originalMsg.reply(`**${message.author.displayName}:** ${clamp(englishOut)}`);
        } catch {
          await parentChannel.send(`**${message.author.displayName}:** ${clamp(englishOut)}`);
        }
      } else {
        await parentChannel.send(`**${message.author.displayName}:** ${clamp(englishOut)}`);
      }

      await message.channel.send(`**${message.author.displayName}:** ${textWithoutUrls}\n> ${py}`);
      await message.delete();
    } catch (err) { console.error("Thread Proxy Error:", err); }
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);