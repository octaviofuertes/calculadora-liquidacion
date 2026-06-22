const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  try {
    const res1 = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: "hello world"
    });
    console.log("text-embedding-004 WORKED");
  } catch (e) {
    console.error("text-embedding-004 ERROR:", e.message);
  }

  try {
    const res2 = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: "hello world"
    });
    console.log("text-embedding-004 WORKED");
  } catch (e) {
    console.error("text-embedding-004 ERROR:", e.message);
  }
}
run();
