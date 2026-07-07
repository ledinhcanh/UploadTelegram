import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

let model: mobilenet.MobileNet | null = null;

const dict: Record<string, string> = {
  "dog": "chó", "puppy": "chó", "hound": "chó",
  "cat": "mèo", "kitten": "mèo",
  "car": "ô tô", "vehicle": "xe cộ",
  "beach": "biển", "sea": "biển", "ocean": "biển",
  "mountain": "núi", "hill": "đồi",
  "tree": "cây", "forest": "rừng",
  "flower": "hoa", "daisy": "hoa", "rose": "hoa",
  "person": "người", "man": "người", "woman": "người",
  "food": "đồ ăn", "pizza": "pizza", "burger": "burger",
  "computer": "máy tính", "laptop": "laptop", "monitor": "màn hình",
  "phone": "điện thoại", "cellular": "điện thoại",
  "book": "sách", "paper": "giấy", "document": "tài liệu",
  "water": "nước", "lake": "hồ", "river": "sông",
  "sky": "bầu trời", "cloud": "mây"
};

async function loadModel() {
  if (!model) {
    try {
      await tf.ready();
      model = await mobilenet.load({ version: 2, alpha: 0.5 });
      self.postMessage({ type: 'MODEL_LOADED' });
    } catch (e) {
      console.error("Lỗi tải AI Model:", e);
    }
  }
}

self.onmessage = async (e) => {
  if (e.data.type === 'LOAD_MODEL') {
    await loadModel();
  } else if (e.data.type === 'CLASSIFY') {
    if (!model) await loadModel();
    if (!model) return;
    
    const { id, imageBitmap } = e.data;
    try {
      const imgTensor = tf.browser.fromPixels(imageBitmap);
      const predictions = await model.classify(imgTensor);
      imgTensor.dispose();

      const tags = predictions.map(p => p.className.toLowerCase()).flatMap(t => t.split(', '));
      
      const translatedTags = tags.map(t => {
         let found = t;
         for (const [en, vi] of Object.entries(dict)) {
             if (t.includes(en)) found = vi;
         }
         return found;
      });

      self.postMessage({ type: 'CLASSIFY_RESULT', id, tags: Array.from(new Set([...tags, ...translatedTags])) });
    } catch (err) {
      console.error("Lỗi Classify:", err);
      self.postMessage({ type: 'CLASSIFY_ERROR', id, error: String(err) });
    }
  }
};
