import { isAvailable, ClaudeLLMProvider } from './src/m5/ClaudeLLMProvider.js';
console.log('API available:', isAvailable());
if (isAvailable()) {
  const claude = new ClaudeLLMProvider();
  console.log('ClaudeLLMProvider created');
}
