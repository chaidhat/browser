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

export const customToolSpecs: CustomToolSpec[] = [
  searchToolSpec,
  consultModelToolSpec,
  consultOpenclawToolSpec,
];

export function buildCustomToolsPromptText(): string {
  return customToolSpecs
    .map((tool) => `- ${tool.name}: ${tool.description}. Args: ${tool.argsDescription}`)
    .join('\n');
}
