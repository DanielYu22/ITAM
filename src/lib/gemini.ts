// Gemini API Client for AI-powered filter generation
import { API_BASE_URL } from '../config';
import { FilterCondition } from './utils';

export interface GeminiConfig {
    apiKey: string;
}

export class GeminiClient {
    private apiKey: string;

    constructor(config: GeminiConfig) {
        this.apiKey = config.apiKey || '';
    }

    private getHeaders(): any {
        const headers: any = {
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['x-goog-api-key'] = this.apiKey;
        }
        return headers;
    }

    async generateFilter(
        prompt: string,
        schema: string[],
        schemaTypes: Record<string, string>
    ): Promise<{ filter: FilterCondition | null; explanation: string }> {
        try {
            const schemaContext = schema.map(field => {
                const type = schemaTypes[field] || 'unknown';
                return `- ${field} (${type})`;
            }).join('\n');

            const systemPrompt = `You are an assistant that converts natural language queries into structured filter conditions for a Notion database.

The database has the following fields:
${schemaContext}

When the user describes a filter condition in natural language, you must return a JSON object that represents the filter.

Filter structure:
{
  "id": "unique_id",
  "field": "field_name",
  "operator": "one of: equals, not_equals, contains, does_not_contain, is_empty, is_not_empty, starts_with, ends_with",
  "value": "the value to filter by (optional for is_empty/is_not_empty)"
}

For complex filters with multiple conditions, use:
{
  "id": "group_id",
  "logic": "AND or OR",
  "conditions": [array of filter conditions]
}

Respond with JSON only, no markdown code blocks. If the query doesn't make sense for filtering, return null.`;

            const response = await fetch(`${API_BASE_URL}/api/gemini/v1beta/models/gemini-2.0-flash:generateContent`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: systemPrompt + "\n\nUser query: " + prompt }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 1024
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('[Gemini] API Error:', response.status, errText);
                return { filter: null, explanation: `API Error: ${response.status}` };
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            console.log('[Gemini] Response:', text);

            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const filter = JSON.parse(jsonMatch[0]);
                    return { filter, explanation: 'AI가 필터를 생성했습니다.' };
                }
            } catch (parseErr) {
                console.error('[Gemini] Parse error:', parseErr);
            }

            return { filter: null, explanation: text || '필터를 생성할 수 없습니다.' };

        } catch (error) {
            console.error('[Gemini] Error:', error);
            return { filter: null, explanation: 'AI 서비스 연결 실패' };
        }
    }

    async analyzeScreenshot(
        imageBase64: string,
        schema: string[]
    ): Promise<{ filter: FilterCondition | null; explanation: string }> {
        try {
            const schemaContext = schema.join(', ');

            const systemPrompt = `You are analyzing a screenshot of a Notion advanced filter.
Extract the filter conditions from the image and convert them to this JSON format.

IMPORTANT: Use ONLY these exact operators:
- "equals" for exact match
- "not_equals" for not equal
- "contains" for contains text
- "does_not_contain" for does not contain
- "is_empty" for empty check
- "is_not_empty" for not empty check

Output structure:
{
  "id": "root",
  "logic": "AND",
  "conditions": [
    {"id": "c1", "field": "field_name", "operator": "contains", "value": "single_value"}
  ]
}

Available fields in this database: ${schemaContext}

Respond with JSON only. Match field names exactly to the available fields listed above.`;

            const response = await fetch(`${API_BASE_URL}/api/gemini/v1beta/models/gemini-2.0-flash:generateContent`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: systemPrompt },
                            {
                                inline_data: {
                                    mime_type: 'image/png',
                                    data: imageBase64
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 2048
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('[Gemini Vision] API Error:', response.status, errText);
                return { filter: null, explanation: `API Error: ${response.status}` };
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const filter = JSON.parse(jsonMatch[0]);
                    return { filter, explanation: '스크린샷에서 필터를 추출했습니다.' };
                }
            } catch (parseErr) {
                console.error('[Gemini Vision] Parse error:', parseErr);
            }

            return { filter: null, explanation: text || '필터를 추출할 수 없습니다.' };

        } catch (error) {
            console.error('[Gemini Vision] Error:', error);
            return { filter: null, explanation: 'AI 서비스 연결 실패' };
        }
    }
    async generateReport(
        templateImages: string[],
        contextImages: string[],
        contextAssets: any[], // Asset[] but avoiding circular dependency if possible, or just use any
        contextTexts: string[],
        userInstruction: string
    ): Promise<{ report: string; error?: string }> {
        try {
            const parts: any[] = [];

            // 1. System Prompt
            parts.push({
                text: `You are an expert reporter. Your task is to generate a comprehensive report based on the provided "Template" and "Context" materials.

INSTRUCTIONS:
1. Analyze the "Template" images (if provided) to understand the required format, structure, tone, and visual layout.
2. Synthesize the "Context" materials (images, data, texts) to extract relevant facts, figures, and insights.
3. Write the report following the "Template" format EXACTLY, filling the content with the information from "Context".
4. If a specific data point is missing in the context but required by the template, indicate it clearly or make a reasonable inference based on available data (stating it's an inference).
5. Output the result in Markdown format.
${userInstruction ? `\nUSER EXTRA INSTRUCTION: ${userInstruction}` : ''}`
            });

            // 2. Add Template Images
            templateImages.forEach((base64, index) => {
                parts.push({ text: `[Template Image ${index + 1}] This is the required report format/style:` });
                parts.push({
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64
                    }
                });
            });

            // 3. Add Context Images
            contextImages.forEach((base64, index) => {
                parts.push({ text: `[Context Image ${index + 1}] Reference material:` });
                parts.push({
                    inline_data: {
                        mime_type: 'image/jpeg',
                        data: base64
                    }
                });
            });

            // 4. Add Context Data (Assets)
            if (contextAssets.length > 0) {
                const assetsText = contextAssets.map(a => JSON.stringify(a.values)).join('\n');
                parts.push({ text: `[Context Data] Database Records:\n${assetsText}` });
            }

            // 5. Add Context Texts
            contextTexts.forEach((text, index) => {
                parts.push({ text: `[Context Text ${index + 1}] Reference document:\n${text}` });
            });

            // Call Gemini 1.5 Flash
            const response = await fetch(`${API_BASE_URL}/api/gemini/v1beta/models/gemini-2.0-flash:generateContent`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 8192 // Long output for full reports
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                // If 429, we might want to suggest waiting, but for now just error
                console.error('[Gemini Report] API Error:', response.status, errText);
                return { report: '', error: `API Error: ${response.status} - ${errText.slice(0, 100)}` };
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            return { report: text };

        } catch (error) {
            console.error('[Gemini Report] Error:', error);
            return { report: '', error: 'Failed to generate report' };
        }
    }
}

