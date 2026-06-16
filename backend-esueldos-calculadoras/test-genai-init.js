const genai = require("@google/genai");
console.log(Object.keys(genai));
try {
  const ai = new genai.GoogleGenAI({ apiKey: "TEST" });
  console.log("GoogleGenAI ok!");
} catch (err) {
  console.error("Error creating GoogleGenAI:", err.message);
  if (genai.Client) {
     console.log("Found Client instead");
  }
}
