interface ResetTokenInfo {
    userId: number;
    expiry: Date;
  }
  
  const resetTokenCache: Map<string, ResetTokenInfo> = new Map();
  
  // Function to store reset token
  export async function storeResetToken(userId: number, token: string, expiry: Date) {
    resetTokenCache.set(token, { userId, expiry });
  }
  
  // Function to get reset token info
  export async function getResetTokenInfo(token: string): Promise<ResetTokenInfo | undefined> {
    return resetTokenCache.get(token);
  }
  
  // Function to delete reset token
  export async function deleteResetToken(token: string) {
    resetTokenCache.delete(token);
  }
  
  // Clean up expired tokens periodically
  setInterval(() => {
    const now = new Date();
    resetTokenCache.forEach((info, token) => {
      if (info.expiry < now) {
        resetTokenCache.delete(token);
      }
    });
  }, 3600000); // Run every hour