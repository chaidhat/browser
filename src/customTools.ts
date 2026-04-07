export interface CustomToolSpec {
  name: string;
  description: string;
  argsDescription: string;
}

export const searchToolSpec: CustomToolSpec = {
  name: 'search',
  description: 'ALWAYS use this tool to search the web with the Brave Search API. If the user is asking for information, your first step should usually be this tool call. Do not rely on any default or implicit web-search capability.',
  argsDescription: '{query: string}',
};

export const consultModelToolSpec: CustomToolSpec = {
  name: 'consultModel',
  description: "Consult another model for a second opinion on questions that require a bachelor's degree level of knowledge or higher. For example, deriving e=mc^2, analyzing legal precedents, or explaining graduate-level algorithms. Do NOT use this for everyday questions, general knowledge, or anything a high schooler could answer. Also use this if the user explicitly asks to use Gemini, Claude, or GPT.",
  argsDescription: '{model: "gpt-5.4" | "gemini-3.1-pro" | "claude-opus-4-6", question: string}',
};

export const consultOpenclawToolSpec: CustomToolSpec = {
  name: 'consultOpenclaw',
  description: 'Consult your self-hosted OpenClaw AI agent. Use this when the user asks to use OpenClaw, or when you want a second opinion from the user\'s private agent. The agent has access to tools and memory on the user\'s server.',
  argsDescription: '{question: string}',
};

export const bashToolSpec: CustomToolSpec = {
  name: 'bash',
  description: 'Execute a shell command on the user\'s computer. Use this when you need to run terminal commands, install packages, check system info, manipulate files, run scripts, or perform any task that requires shell access. The command runs in the user\'s default shell.',
  argsDescription: '{command: string}',
};

export const thinkingToolSpec: CustomToolSpec = {
  name: 'thinking',
  description: 'Share your current thinking with the user. Use this frequently to show your reasoning process, what you are considering, what you are uncertain about, and why you are making the choices you are making. Be as honest and transparent as possible — include doubts, tradeoffs, and things you might be wrong about. The user wants to see your real thought process, not a polished summary.',
  argsDescription: '{thought: string}',
};

export const readDiscordToolSpec: CustomToolSpec = {
  name: 'readDiscord',
  description: 'Fetch recent messages from a Discord channel. Use this when the user asks about Discord messages, wants to check a channel, or asks what people are saying on Discord. Returns the latest messages with author, content, and timestamp.',
  argsDescription: '{channelId: string, limit: number} — pass "" for channelId to use the default channel, pass 0 for limit to use default',
};

export const readEmailToolSpec: CustomToolSpec = {
  name: 'readEmail',
  description: 'Fetch recent emails from the user\'s configured IMAP email account. Use this when the user asks about their email, wants to check their inbox, or asks what emails they have. Returns recent messages with subject, sender, date, and body preview.',
  argsDescription: '{accountLabel: string, limit: number} — pass "" for accountLabel to use the default account, pass 0 for limit to use default',
};

export const customToolSpecs: CustomToolSpec[] = [
  searchToolSpec,
  consultModelToolSpec,
  consultOpenclawToolSpec,
  bashToolSpec,
  thinkingToolSpec,
  readDiscordToolSpec,
  readEmailToolSpec,
];

export function buildCustomToolsPromptText(): string {
  return customToolSpecs
    .map((tool) => `- ${tool.name}: ${tool.description}. Args: ${tool.argsDescription}`)
    .join('\n');
}
