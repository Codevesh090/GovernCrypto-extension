/**
 * Language Detection
 * Detects the language of text to select the appropriate voice
 * Enhanced with franc-min for better accuracy
 */

import { franc } from 'franc-min';

/**
 * Detect language from text using franc-min + character patterns and common words
 */
export function detectLanguage(text: string): string {
  if (!text || text.length < 3) return 'en';
  
  const sample = text.substring(0, 200).toLowerCase();
  
  // Try franc-min first for better accuracy (only if text is long enough)
  if (text.length >= 20) {
    const francResult = franc(text, { minLength: 10 });
    console.log('[Language Detection] franc-min result:', francResult);
    
    // Map franc ISO 639-3 codes to our 2-letter codes
    const francMap: Record<string, string> = {
      'eng': 'en',
      'hin': 'hi',
      'spa': 'es',
      'fra': 'fr',
      'deu': 'de',
      'por': 'pt',
      'cmn': 'zh',
      'jpn': 'ja',
      'kor': 'ko',
      'rus': 'ru',
      'ita': 'it',
      'nld': 'nl',
      'tur': 'tr',
      'vie': 'vi',
      'arb': 'ar'
    };
    
    if (francResult && francResult !== 'und' && francMap[francResult]) {
      console.log('[Language Detection] Using franc-min detection:', francMap[francResult]);
      return francMap[francResult];
    }
  }
  
  // Hindi/Devanagari script detection (HIGHEST PRIORITY)
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  
  // Romanized Hindi/Hinglish detection (BEFORE other Latin-script languages)
  // Common Hindi words written in Latin script
  if (/(mujhe|tumhe|kya|hai|hain|aap|tum|yeh|yah|kaise|kahan|kyun|kab|samajh|samjh|proposal|karta|karti|karte|chahiye|chahte|batao|bata|dijiye|please|kar|karo|hoga|hogi|honge|tha|thi|the|nahi|nahin|haan|ji|bhi|aur|ya|lekin|par|ke|ki|ka|ko|se|me|mein|pe|tak|bahut|bohot|thoda|zyada|jyada)/i.test(sample)) {
    console.log('[Language Detection] Detected Romanized Hindi/Hinglish');
    return 'hi';
  }
  
  // Chinese characters
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return 'zh';
  }
  
  // Japanese (Hiragana, Katakana, Kanji)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
    return 'ja';
  }
  
  // Korean (Hangul)
  if (/[\uAC00-\uD7AF]/.test(text)) {
    return 'ko';
  }
  
  // Arabic script
  if (/[\u0600-\u06FF]/.test(text)) {
    return 'ar';
  }
  
  // Cyrillic (Russian)
  if (/[\u0400-\u04FF]/.test(text)) {
    return 'ru';
  }
  
  // Spanish common words and patterns
  if (/(el |la |los |las |que |de |en |un |una |por |para |con |está|qué|cómo|dónde)/i.test(sample)) {
    return 'es';
  }
  
  // French common words
  if (/(le |la |les |de |un |une |et |est |dans |pour |avec |ce |qui |que |où|ça|très)/i.test(sample)) {
    return 'fr';
  }
  
  // German common words
  if (/(der |die |das |und |ist |in |den |von |zu |mit |auf |für |ein |eine |nicht|wie|was|wo)/i.test(sample)) {
    return 'de';
  }
  
  // Portuguese common words
  if (/(o |a |os |as |de |em |um |uma |para |com |que |não|é|está|como|onde)/i.test(sample)) {
    return 'pt';
  }
  
  // Italian common words
  if (/(il |lo |la |i |gli |le |di |da |in |con |su |per |un |una |che |è|sono|come|dove)/i.test(sample)) {
    return 'it';
  }
  
  // Dutch common words
  if (/(de |het |een |van |in |op |te |voor |met |aan |is |zijn|wat|hoe|waar)/i.test(sample)) {
    return 'nl';
  }
  
  // Turkish common words
  if (/(bir |bu |ve |için |ile |de |da |mi |mı|ne|nasıl|nerede)/i.test(sample)) {
    return 'tr';
  }
  
  // Vietnamese common words
  if (/(là |của |và |có |được|không|này|đó|như|gì)/i.test(sample)) {
    return 'vi';
  }
  
  // Default to English
  return 'en';
}

/**
 * Get language name for display
 */
export function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    'en': 'English',
    'hi': 'Hindi',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'pt': 'Portuguese',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ru': 'Russian',
    'it': 'Italian',
    'nl': 'Dutch',
    'tr': 'Turkish',
    'vi': 'Vietnamese',
    'ar': 'Arabic'
  };
  return names[code] || 'English';
}
