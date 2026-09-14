// ============================================================================
// 固化文件存储系统：固化正式队员账号，彻底告别 KV 限制与 429 报错
// ============================================================================

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  name: string;
  avatar: string;
  phone: string;
  aliases: string[];
}

/**
 * 所有正式系统队员账号信息永久固化在此文件中
 * 1. 娄 Anglyao (主管/管理员): 密码 1717321
 * 2. 秋: 密码 1717321
 * 3. 路佳岷: 密码 qwe123
 */
export const HARDCODED_ACCOUNTS: UserAccount[] = [
  {
    id: 'user_anglyao',
    username: 'anglyao',
    password: '1717321',
    name: '娄 Anglyao',
    avatar: '',
    phone: '+86 15314519108',
    aliases: [
      'anglyao',
      'Anglyao778@gmail.com',
      'anglyao778@gmail.com',
      '15314519108',
      'anglyao778',
      '娄 Anglyao',
      '娄anglyao',
    ],
  },
  {
    id: 'user_18370602609',
    username: '18370602609',
    password: '1717321',
    name: '秋',
    avatar: '',
    phone: '+86 152 7969 9719',
    aliases: [
      '18370602609',
      '15279699719',
      '秋',
    ],
  },
  {
    id: 'user_Lulinhaohan',
    username: 'Lulinhaohan',
    password: 'qwe123',
    name: '路佳岷',
    avatar: '',
    phone: 'Lulinhaohan',
    aliases: [
      'Lulinhaohan',
      'lulinhaohan',
      '路佳岷',
    ],
  },
];

/**
 * 根据用户名、邮箱、手机号或姓名查找固化账号
 */
export function findHardcodedAccount(identifier: string): UserAccount | null {
  if (!identifier) return null;
  const raw = identifier.trim();
  const lower = raw.toLowerCase();
  const digitsOnly = lower.replace(/\D/g, '');

  for (const acc of HARDCODED_ACCOUNTS) {
    // 1. 精确与小写匹配
    if (acc.username.toLowerCase() === lower || acc.id.toLowerCase() === lower || acc.name.toLowerCase() === lower) {
      return acc;
    }

    // 2. 别名匹配
    if (acc.aliases.some((a) => a.toLowerCase() === lower)) {
      return acc;
    }

    // 3. 纯数字手机号匹配 (>=7 位)
    if (digitsOnly.length >= 7) {
      const accPhoneDigits = (acc.phone || '').replace(/\D/g, '');
      if (accPhoneDigits.endsWith(digitsOnly) || digitsOnly.endsWith(accPhoneDigits)) {
        return acc;
      }
      for (const a of acc.aliases) {
        const aDigits = a.replace(/\D/g, '');
        if (aDigits.length >= 7 && (aDigits.endsWith(digitsOnly) || digitsOnly.endsWith(aDigits))) {
          return acc;
        }
      }
    }

    // 4. 邮箱前缀匹配 (例如用户输入 anglyao 匹配 Anglyao778@gmail.com)
    for (const a of acc.aliases) {
      if (a.includes('@')) {
        const prefix = a.toLowerCase().split('@')[0];
        if (prefix === lower || prefix.startsWith(lower) || lower.startsWith(prefix)) {
          return acc;
        }
      }
    }
  }

  return null;
}
