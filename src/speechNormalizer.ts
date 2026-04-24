/**
 * Speech Normalizer
 * Converts text to be more TTS-friendly by normalizing numbers, currency, and acronyms
 */

/**
 * Normalize text for TTS based on language
 * Converts numbers, currency, and acronyms to speakable forms
 */
export function normalizeForSpeech(text: string, language: string): string {
  let normalized = text;
  
  // Apply language-specific normalization
  switch (language) {
    case 'hi': // Hindi
      normalized = normalizeHindi(normalized);
      break;
    case 'es': // Spanish
      normalized = normalizeSpanish(normalized);
      break;
    case 'fr': // French
      normalized = normalizeFrench(normalized);
      break;
    case 'de': // German
      normalized = normalizeGerman(normalized);
      break;
    case 'pt': // Portuguese
      normalized = normalizePortuguese(normalized);
      break;
    case 'en': // English
    default:
      normalized = normalizeEnglish(normalized);
      break;
  }
  
  return normalized;
}

/**
 * Normalize English text for TTS
 */
function normalizeEnglish(text: string): string {
  let result = text;
  
  // Currency: $1000 → one thousand dollars
  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (match, amount) => {
    const num = parseFloat(amount.replace(/,/g, ''));
    return numberToEnglishWords(num) + ' dollars';
  });
  
  // Percentages: 50% → fifty percent
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
    return numberToEnglishWords(parseFloat(num)) + ' percent';
  });
  
  // Large numbers with commas: 1,000 → one thousand
  result = result.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (match, num) => {
    return numberToEnglishWords(parseFloat(num.replace(/,/g, '')));
  });
  
  // Common acronyms
  result = result.replace(/\bDAO\b/g, 'D A O');
  result = result.replace(/\bNFT\b/g, 'N F T');
  result = result.replace(/\bDeFi\b/g, 'D eFi');
  result = result.replace(/\bETH\b/g, 'E T H');
  
  return result;
}

/**
 * Normalize Hindi text for TTS
 */
function normalizeHindi(text: string): string {
  let result = text;
  
  // Currency: $1000 → ek hazar dollar
  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (match, amount) => {
    const num = parseFloat(amount.replace(/,/g, ''));
    return numberToHindiWords(num) + ' dollar';
  });
  
  // Percentages: 50% → pachaas pratishat
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
    return numberToHindiWords(parseFloat(num)) + ' pratishat';
  });
  
  // Large numbers: 1000 → ek hazar
  result = result.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (match, num) => {
    return numberToHindiWords(parseFloat(num.replace(/,/g, '')));
  });
  
  // Standalone numbers
  result = result.replace(/\b(\d+)\b/g, (match, num) => {
    return numberToHindiWords(parseInt(num));
  });
  
  return result;
}

/**
 * Normalize Spanish text for TTS
 */
function normalizeSpanish(text: string): string {
  let result = text;
  
  // Currency: $1000 → mil dólares
  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (match, amount) => {
    const num = parseFloat(amount.replace(/,/g, ''));
    return numberToSpanishWords(num) + ' dólares';
  });
  
  // Percentages: 50% → cincuenta por ciento
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
    return numberToSpanishWords(parseFloat(num)) + ' por ciento';
  });
  
  return result;
}

/**
 * Normalize French text for TTS
 */
function normalizeFrench(text: string): string {
  let result = text;
  
  // Currency: $1000 → mille dollars
  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (match, amount) => {
    const num = parseFloat(amount.replace(/,/g, ''));
    return numberToFrenchWords(num) + ' dollars';
  });
  
  // Percentages: 50% → cinquante pour cent
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
    return numberToFrenchWords(parseFloat(num)) + ' pour cent';
  });
  
  return result;
}

/**
 * Normalize German text for TTS
 */
function normalizeGerman(text: string): string {
  let result = text;
  
  // Currency: $1000 → tausend Dollar
  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (match, amount) => {
    const num = parseFloat(amount.replace(/,/g, ''));
    return numberToGermanWords(num) + ' Dollar';
  });
  
  // Percentages: 50% → fünfzig Prozent
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
    return numberToGermanWords(parseFloat(num)) + ' Prozent';
  });
  
  return result;
}

/**
 * Normalize Portuguese text for TTS
 */
function normalizePortuguese(text: string): string {
  let result = text;
  
  // Currency: $1000 → mil dólares
  result = result.replace(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (match, amount) => {
    const num = parseFloat(amount.replace(/,/g, ''));
    return numberToPortugueseWords(num) + ' dólares';
  });
  
  // Percentages: 50% → cinquenta por cento
  result = result.replace(/(\d+(?:\.\d+)?)%/g, (match, num) => {
    return numberToPortugueseWords(parseFloat(num)) + ' por cento';
  });
  
  return result;
}

/**
 * Convert number to English words (simplified)
 */
function numberToEnglishWords(num: number): string {
  if (num === 0) return 'zero';
  
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return tens[ten] + (one > 0 ? ' ' + ones[one] : '');
  }
  if (num < 1000) {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return ones[hundred] + ' hundred' + (rest > 0 ? ' ' + numberToEnglishWords(rest) : '');
  }
  if (num < 1000000) {
    const thousand = Math.floor(num / 1000);
    const rest = num % 1000;
    return numberToEnglishWords(thousand) + ' thousand' + (rest > 0 ? ' ' + numberToEnglishWords(rest) : '');
  }
  if (num < 1000000000) {
    const million = Math.floor(num / 1000000);
    const rest = num % 1000000;
    return numberToEnglishWords(million) + ' million' + (rest > 0 ? ' ' + numberToEnglishWords(rest) : '');
  }
  
  return num.toString(); // fallback for very large numbers
}

/**
 * Convert number to Hindi words (simplified)
 */
function numberToHindiWords(num: number): string {
  if (num === 0) return 'shunya';
  
  const ones = ['', 'ek', 'do', 'teen', 'char', 'panch', 'chhah', 'saat', 'aath', 'nau'];
  const teens = ['das', 'gyarah', 'barah', 'terah', 'chaudah', 'pandrah', 'solah', 'satrah', 'atharah', 'unnis'];
  const tens = ['', '', 'bees', 'tees', 'chalis', 'pachaas', 'saath', 'sattar', 'assi', 'nabbe'];
  
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return tens[ten] + (one > 0 ? ' ' + ones[one] : '');
  }
  if (num < 1000) {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return ones[hundred] + ' sau' + (rest > 0 ? ' ' + numberToHindiWords(rest) : '');
  }
  if (num < 100000) {
    const thousand = Math.floor(num / 1000);
    const rest = num % 1000;
    return numberToHindiWords(thousand) + ' hazar' + (rest > 0 ? ' ' + numberToHindiWords(rest) : '');
  }
  if (num < 10000000) {
    const lakh = Math.floor(num / 100000);
    const rest = num % 100000;
    return numberToHindiWords(lakh) + ' lakh' + (rest > 0 ? ' ' + numberToHindiWords(rest) : '');
  }
  
  return num.toString(); // fallback
}

/**
 * Convert number to Spanish words (simplified)
 */
function numberToSpanishWords(num: number): string {
  if (num === 0) return 'cero';
  
  const ones = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
  const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return tens[ten] + (one > 0 ? ' y ' + ones[one] : '');
  }
  if (num < 1000) {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return (hundred === 1 ? 'cien' : ones[hundred] + 'cientos') + (rest > 0 ? ' ' + numberToSpanishWords(rest) : '');
  }
  if (num < 1000000) {
    const thousand = Math.floor(num / 1000);
    const rest = num % 1000;
    return (thousand === 1 ? 'mil' : numberToSpanishWords(thousand) + ' mil') + (rest > 0 ? ' ' + numberToSpanishWords(rest) : '');
  }
  
  return num.toString();
}

/**
 * Convert number to French words (simplified)
 */
function numberToFrenchWords(num: number): string {
  if (num === 0) return 'zéro';
  
  const ones = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];
  
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return tens[ten] + (one > 0 ? '-' + ones[one] : '');
  }
  if (num < 1000) {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return (hundred === 1 ? 'cent' : ones[hundred] + ' cent') + (rest > 0 ? ' ' + numberToFrenchWords(rest) : '');
  }
  if (num < 1000000) {
    const thousand = Math.floor(num / 1000);
    const rest = num % 1000;
    return (thousand === 1 ? 'mille' : numberToFrenchWords(thousand) + ' mille') + (rest > 0 ? ' ' + numberToFrenchWords(rest) : '');
  }
  
  return num.toString();
}

/**
 * Convert number to German words (simplified)
 */
function numberToGermanWords(num: number): string {
  if (num === 0) return 'null';
  
  const ones = ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
  const teens = ['zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const tens = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
  
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return (one > 0 ? ones[one] + 'und' : '') + tens[ten];
  }
  if (num < 1000) {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return ones[hundred] + 'hundert' + (rest > 0 ? numberToGermanWords(rest) : '');
  }
  if (num < 1000000) {
    const thousand = Math.floor(num / 1000);
    const rest = num % 1000;
    return (thousand === 1 ? 'tausend' : numberToGermanWords(thousand) + 'tausend') + (rest > 0 ? numberToGermanWords(rest) : '');
  }
  
  return num.toString();
}

/**
 * Convert number to Portuguese words (simplified)
 */
function numberToPortugueseWords(num: number): string {
  if (num === 0) return 'zero';
  
  const ones = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const teens = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const tens = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  
  if (num < 10) return ones[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return tens[ten] + (one > 0 ? ' e ' + ones[one] : '');
  }
  if (num < 1000) {
    const hundred = Math.floor(num / 100);
    const rest = num % 100;
    return (hundred === 1 ? 'cem' : ones[hundred] + 'centos') + (rest > 0 ? ' e ' + numberToPortugueseWords(rest) : '');
  }
  if (num < 1000000) {
    const thousand = Math.floor(num / 1000);
    const rest = num % 1000;
    return (thousand === 1 ? 'mil' : numberToPortugueseWords(thousand) + ' mil') + (rest > 0 ? ' e ' + numberToPortugueseWords(rest) : '');
  }
  
  return num.toString();
}
