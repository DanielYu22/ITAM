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
}
