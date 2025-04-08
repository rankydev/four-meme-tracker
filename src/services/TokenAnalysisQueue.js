export class TokenAnalysisQueue {
    constructor() {
      this.queue = new Map();
      this.analysisDelay = 10; // Analyze after 10 blocks
    }
  
    enqueueToken(tokenAddress, tokenInfo, creationBlock) {
      this.queue.set(tokenAddress, {
        creationBlock,
        tokenInfo,
        targetBlock: BigInt(creationBlock) + BigInt(this.analysisDelay)
      });
    }
  
    checkForAnalysis(currentBlock) {
      const tokensToAnalyze = [];
      const tokensToRemove = [];
  
      for (const [address, data] of this.queue.entries()) {
        if (BigInt(currentBlock) >= data.targetBlock) {
          tokensToAnalyze.push({ address, ...data });
          tokensToRemove.push(address);
        }
      }
  
      tokensToRemove.forEach(address => this.queue.delete(address));
      return tokensToAnalyze;
    }
  }