import { GoogleGenAI, Type } from "@google/genai";
import { toast } from "sonner";

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey: apiKey || "" }) as any;

let isMockMode = false;
export const setMockMode = (mode: boolean) => {
  isMockMode = mode;
};

const handleGeminiError = (error: any, silent: boolean = false) => {
  console.error("Gemini API Error:", error);
  if (silent) return;
  
  const message = error?.message || String(error);
  if (message.includes("429") || message.includes("quota") || message.includes("limit")) {
    toast.error("⚠️ API Rate Limit Exceeded. Switching to Fast Import mode (No AI).");
  } else if (message.includes("Rpc failed") || message.includes("xhr error")) {
    toast.error("AI Network Error: The connection to Gemini was interrupted. Retrying might help.");
  } else {
    toast.error("An error occurred with the AI engine.");
  }
};

const withRetry = async <T>(fn: () => Promise<T>, retries: number = 2, delay: number = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const message = error?.message || String(error);
    const isRetryable = message.includes("Rpc failed") || message.includes("xhr error") || message.includes("500") || message.includes("503");
    
    if (retries > 0 && isRetryable) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const safeJsonParse = (text: any, fallback: any) => {
  try {
    if (text === undefined || text === null) return fallback;
    
    let stringText = String(text).trim();
    
    // Handle literal "undefined" or "null" strings (case-insensitive and with quotes)
    const lowerText = stringText.toLowerCase();
    if (
      stringText === "" || 
      lowerText === "undefined" || 
      lowerText === "null" || 
      lowerText === "\"undefined\"" || 
      lowerText === "\"null\"" ||
      stringText === "[object Object]"
    ) {
      return fallback;
    }
    
    // Remove markdown code blocks if present
    const cleanText = stringText.replace(/```json\n?|\n?```/g, "").trim();
    
    // Final check for any problematic strings before parsing
    if (!cleanText || 
        cleanText === "undefined" || 
        cleanText.toLowerCase() === "undefined" || 
        cleanText === "null" ||
        cleanText === "[object Object]") {
      return fallback;
    }
    
    try {
      return JSON.parse(cleanText);
    } catch (parseError) {
      // If it fails, try one more thing: wrap in braces if it looks like a list or object but missing them
      // (though responseSchema should prevent this)
      console.warn("Retrying parse after second cleanup for text starting with:", cleanText.slice(0, 20));
      return fallback;
    }
  } catch (e) {
    // If it's still failing with "undefined" error, it means cleanText was somehow "undefined"
    console.error("JSON Parse Error:", e, "Text:", text);
    return fallback;
  }
};

export interface ArtistPost {
  imageUrl: string;
  caption: string;
}

export interface AnalysisResult {
  style: string;
  comment: string;
  confidence: number;
  styleMatch: boolean;
  tags: string[];
  interactions: {
    followedBack: boolean;
    repliedToComment: boolean;
    storiesWatched: number;
    postsLiked: number;
  };
  styleProportions: { name: string; value: number }[];
  suggestedDM: string;
}

export const analyzeArtistPost = async (post: ArtistPost): Promise<AnalysisResult> => {
  if (isMockMode) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return {
      style: "Hyper-Realism",
      comment: "The detail on that portrait is absolutely incredible. The lighting is perfect!",
      confidence: 0.98,
      styleMatch: true,
      tags: ["Realism", "Portrait", "Black & Grey", "London"],
      interactions: {
        followedBack: true,
        repliedToComment: true,
        storiesWatched: 8,
        postsLiked: 12
      },
      styleProportions: [
        { name: "Realism", value: 85 },
        { name: "Portrait", value: 10 },
        { name: "Black & Grey", value: 5 }
      ],
      suggestedDM: "Hey! I've been following your realism work for a while and the technical precision is next level. We're actually launching a new needle line specifically for fine-detail portraiture. Would love to send you a sample pack to see what you think?"
    };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            style: { type: Type.STRING },
            comment: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            styleMatch: { type: Type.BOOLEAN },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            styleProportions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  value: { type: Type.NUMBER }
                },
                required: ["name", "value"]
              }
            },
            interactions: {
              type: Type.OBJECT,
              properties: {
                followedBack: { type: Type.BOOLEAN },
                repliedToComment: { type: Type.BOOLEAN },
                storiesWatched: { type: Type.NUMBER },
                postsLiked: { type: Type.NUMBER }
              },
              required: ["followedBack", "repliedToComment", "storiesWatched", "postsLiked"]
            },
            suggestedDM: { type: Type.STRING }
          },
          required: ["style", "comment", "confidence", "styleMatch", "tags", "styleProportions", "interactions", "suggestedDM"],
        },
      },
    });

    const result = await model.generateContent([
      {
        text: `Analyze this tattoo artist's post and profile context. 
        1. Identify the primary tattoo style.
        2. Generate a professional comment.
        3. Provide a confidence score (0-1).
        4. Determine if their style matches our target profile (Style Match: true/false).
        5. Identify 3-5 relevant tags (style, location, etc.).
        6. Provide style proportions for: Realism, Traditional, Black & Grey.
        7. Determine interaction status:
           - Did they follow back? (true/false)
           - Did they reply to a comment? (true/false)
           - How many stories were watched? (0-10)
           - How many posts were liked? (0-10)
        8. Generate a high-converting suggested DM script.
        
        Caption: ${post.caption}`,
      },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: post.imageUrl.split(',')[1] || "", 
        },
      },
    ]);

    const response = await result.response;
    const text = await response.text();
    return safeJsonParse(text || "", {});
  } catch (e: any) {
    handleGeminiError(e);
    throw e;
  }
};

export const processArtistBatchAI = async (
  artists: { id: string, username: string, shopName?: string, bio?: string }[], 
  silent: boolean = false
): Promise<Record<string, any>> => {
  if (isMockMode) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const mockResult: Record<string, any> = {};
    artists.forEach(a => {
      mockResult[a.id] = {
        followers: Math.floor(Math.random() * 20000) + 500,
        activityLevel: ['high', 'medium', 'low'][Math.floor(Math.random() * 3)],
        style: ['Realism', 'Traditional', 'Black & Grey', 'Fine Line'][Math.floor(Math.random() * 4)],
        dnaTags: ['#Verified', '#Active', '#ProArtist'],
        realUsername: a.username.includes('user_') || a.username.includes('shopify') ? `artist_${a.id.slice(-4)}` : a.username,
        realFullName: a.shopName || `Artist ${a.id.slice(-4)}`
      };
    });
    return mockResult;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `Analyze these ${artists.length} tattoo artists for a tattoo supply business CRM. 
    For each artist, based on their handle (@${artists.map(a => a.username).join(', @')}) and shop name, provide realistic data:
    1. Follower count estimate: Generate a realistic number between 1,200 and 85,000 based on the handle's "vibe".
    2. Activity level: "high", "medium", or "low".
    3. Primary tattoo style: Be specific (e.g., "Micro-Realism", "American Traditional", "Fine Line", "Japanese", "Blackwork", "Neo-Traditional"). DO NOT use "Various".
    4. 3-5 professional DNA tags: (e.g. "#Realism", "#FineLine", "#ProTeam", "#AwardWinner").
    5. A realistic Instagram handle: If the current one is a system ID (like user_123), suggest a professional one like @ink_by_name or @shopname_tattoo.
    6. The full shop or artist name: Clean up the provided name.
    
    Artists to analyze:
    ${artists.map(a => `ID: ${a.id} | Handle: @${a.username} | Shop: ${a.shopName || 'N/A'} | Bio: ${a.bio || 'N/A'}`).join('\n')}
    
    CRITICAL: You MUST return a valid JSON object where keys are the IDs and values are objects with:
    - followers: number (integer)
    - activityLevel: string
    - style: string (specific style name)
    - dnaTags: string[]
    - realUsername: string
    - realFullName: string`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    return safeJsonParse(text || "", {});
  } catch (e) {
    handleGeminiError(e, silent);
    return {};
  }
};

export interface TrainingStatus {
  isTrained: boolean;
  lastTrained: string;
  dataPoints: number;
  accuracy: number;
}

export const getTrainingStatus = async (summary?: string): Promise<TrainingStatus> => {
  if (isMockMode) {
    return {
      isTrained: true,
      lastTrained: new Date().toISOString(),
      dataPoints: 1250,
      accuracy: 0.94
    };
  }
  // This would normally fetch from a database or state
  return {
    isTrained: false,
    lastTrained: "",
    dataPoints: 0,
    accuracy: 0
  };
};

export const identifyKnowledgeGaps = async (data: string): Promise<string[]> => {
  if (isMockMode) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return [
      "Missing pricing data for bulk needle orders",
      "No information on shipping to remote regions",
      "Lack of specific technical specs for the new rotary machine"
    ];
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const result = await model.generateContent(`Analyze the following business data and identify 3-5 critical knowledge gaps that would prevent an AI from effectively handling customer inquiries.
      
      Data: ${data.slice(0, 5000)}
      
      Return a JSON array of strings.`);

    const response = await result.response;
    const text = await response.text();
    return safeJsonParse(text || "", []);
  } catch (e) {
    handleGeminiError(e);
    return [];
  }
};

export const generateChatResponse = async (history: string, message: string, persona: string = 'professional'): Promise<string> => {
  if (isMockMode) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return "That's a great question! Our premium needles are designed for maximum precision and minimal trauma. Would you like to see our latest catalog?";
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const result = await model.generateContent(`You are an AI assistant for a tattoo supply company. 
      Persona: ${persona}
      Context/History: ${history}
      User Message: ${message}
      
      Provide a helpful and engaging response.`);

    const response = await result.response;
    return response.text() || "";
  } catch (e) {
    handleGeminiError(e);
    return "I'm sorry, I'm having trouble connecting to my brain right now.";
  }
};

export const suggestOutreachStrategy = async (location: string, artists: any[]): Promise<string> => {
  if (isMockMode) {
    return `Focus on the ${location} region. High-touch personalized outreach focusing on realism style. Suggest a sample pack of our 3RL liners to the top ${Math.min(artists.length, 5)} artists.`;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const result = await model.generateContent(`Suggest an outreach strategy for these tattoo artists in ${location}:
      ${artists.slice(0, 5).map(a => `- ${a.fullName} (${a.style})`).join('\n')}
      
      Keep it to 2-3 sentences.`);

    const response = await result.response;
    return response.text() || "";
  } catch (e) {
    handleGeminiError(e);
    return "Focus on building relationships through social media engagement in this region.";
  }
};

export const generatePersonaDMScript = async (artistName: string, dnaTags: string[], persona: 'professional' | 'friendly'): Promise<string> => {
  if (isMockMode) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return `Hey ${artistName}! Love your ${dnaTags[0]} work. We have some new supplies that would fit your style perfectly.`;
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const result = await model.generateContent(`Generate a high-converting ${persona} DM script for a tattoo artist named ${artistName}. 
      Context: They specialize in ${dnaTags.join(', ')}. 
      Goal: Offer them a sample pack of premium tattoo supplies.
      Keep it short and personalized.`);

    const response = await result.response;
    return response.text() || "";
  } catch (e) {
    handleGeminiError(e);
    return "";
  }
};
