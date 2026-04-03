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
  description: "ALWAYS consult another model for a second opinion to a question that requiers a high school degree or more to answer. For example, if the user asks about deriving e=mc^2 then you'd consult gemini and claude. Write the question you want to consult the model. If I tell it to use Gemini or Claude please use this tool call.",
  argsDescription: '{model: "gemini-3.1-pro" | "claude-opus-4-6", question: string}',
};

export const customToolSpecs: CustomToolSpec[] = [
  searchToolSpec,
  consultModelToolSpec,
];

export function buildCustomToolsPromptText(): string {
  return customToolSpecs
    .map((tool) => `- ${tool.name}: ${tool.description}. Args: ${tool.argsDescription}`)
    .join('\n');
}
