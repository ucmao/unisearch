import fs from 'fs';
import path from 'path';
import { Segment } from 'segmentit';
import { activeConfig } from './config';

let _segment: any = null;

function getSegmenter() {
  if (!_segment) {
    const { Segment } = require('segmentit');
    _segment = new Segment();
    _segment.useDefault();
  }
  return _segment;
}

export function loadStopWords(filePath: string): Set<string> {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(resolvedPath)) {
    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return new Set(content.split('\n').map((s) => s.trim()).filter(Boolean));
    } catch (err) {
      console.error('[Words] Error loading stop words file:', err);
    }
  }
  return new Set();
}

export function generateWordFrequency(commentsData: Array<{ content: string }>, outputPrefix: string): void {
  console.log(`[Words] Generating word frequency from ${commentsData.length} comments`);
  try {
    const allText = commentsData.map((c) => c.content || '').join(' ');
    
    // Perform segmentation
    const segmenter = getSegmenter();
    const tokens = segmenter.doSegment(allText);
    
    // Load stop words
    const stopWords = loadStopWords(activeConfig.STOP_WORDS_FILE);
    
    // Count frequencies
    const freq: Record<string, number> = {};
    for (const token of tokens) {
      const word = token.w.trim();
      if (word && word.length > 1 && !stopWords.has(word)) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }

    // Sort and format as JSON
    const sortedFreq = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [word, count]) => {
        obj[word] = count;
        return obj;
      }, {} as Record<string, number>);

    const outputDir = path.dirname(outputPrefix);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const freqFilePath = `${outputPrefix}_word_freq.json`;
    fs.writeFileSync(freqFilePath, JSON.stringify(sortedFreq, null, 4), 'utf-8');
    console.log(`[Words] Word frequency JSON successfully saved to: ${freqFilePath}`);

    // Create a mock word cloud text representation
    const cloudFilePath = `${outputPrefix}_word_cloud.png`;
    // We create a tiny placeholder text/image file to prevent downstream file-not-found issues
    fs.writeFileSync(cloudFilePath, Buffer.from([])); 
  } catch (err) {
    console.error('[Words] Error generating word frequency:', err);
  }
}
