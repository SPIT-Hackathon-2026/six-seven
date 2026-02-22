const fs = require('fs');

function fixTailwind(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  const replacements = [
    { from: /bg-\[#000000\]/g, to: 'bg-white dark:bg-black' },
    { from: /bg-\[#0a0a0a\]/g, to: 'bg-neutral-50 dark:bg-zinc-900' },
    { from: /bg-\[#111111\]/g, to: 'bg-neutral-100 dark:bg-zinc-800' },
    { from: /border-\[#1a1a1a\]/g, to: 'border-neutral-200 dark:border-zinc-800' },
    { from: /border-\[#111111\]/g, to: 'border-neutral-100 dark:border-zinc-800' },
    { from: /border-\[#222\]/g, to: 'border-neutral-200 dark:border-zinc-800' },
    { from: /border-\[#222222\]/g, to: 'border-neutral-200 dark:border-zinc-800' },
    { from: /text-\[#e6edf3\]/g, to: 'text-black dark:text-neutral-100' },
    { from: /text-\[#484f58\]/g, to: 'text-neutral-500 dark:text-neutral-400' },
    { from: /text-\[#8b949e\]/g, to: 'text-neutral-500 dark:text-neutral-400' },
    { from: /text-\[#000000\]/g, to: 'text-white dark:text-black' },
  ];

  for (const r of replacements) {
    content = content.replace(r.from, r.to);
  }

  // Also replace some specific static values
  content = content.replace(/color: '"#000000"'/g, "color: isDark ? '#000000' : '#ffffff'");
  
  fs.writeFileSync(filePath, content);
}

function fixSearchInline(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Inject useColorScheme import if not present
  if (!content.includes('useColorScheme')) {
    content = content.replace(
      /from 'react-native'/,
      "from 'react-native'\nimport { useColorScheme } from 'nativewind'"
    );
  }

  // Inject useColorScheme call into component
  if (!content.includes('const { colorScheme } = useColorScheme()')) {
    content = content.replace(
      /export default function SearchScreen\(\) \{/,
      "export default function SearchScreen() {\n  const { colorScheme } = useColorScheme()\n  const isDark = colorScheme === 'dark'"
    );
  }

  // Replace Hex Codes with ternaries
  const inlineReplacements = [
    { from: /'#000000'/g, to: "isDark ? '#000000' : '#ffffff'" },
    { from: /'#111111'/g, to: "isDark ? '#111111' : '#f5f5f5'" },
    { from: /'#0a0a0a'/g, to: "isDark ? '#0a0a0a' : '#fafafa'" },
    { from: /'#1a1a1a'/g, to: "isDark ? '#1a1a1a' : '#e5e5e5'" },
    { from: /'#222222'/g, to: "isDark ? '#222222' : '#d4d4d4'" },
    { from: /'#222'/g,    to: "isDark ? '#222' : '#d4d4d4'" },
    { from: /'#e6edf3'/g, to: "isDark ? '#e6edf3' : '#000000'" },
    { from: /'#484f58'/g, to: "isDark ? '#484f58' : '#737373'" },
    { from: /'#8b949e'/g, to: "isDark ? '#8b949e' : '#737373'" },
    { from: /'#333333'/g, to: "isDark ? '#333333' : '#a3a3a3'" }
  ];

  for (const r of inlineReplacements) {
    content = content.replace(r.from, r.to);
  }

  fs.writeFileSync(filePath, content);
}

fixTailwind('src/app/transfer.tsx');
fixSearchInline('src/app/search.tsx');
console.log('Fixed themes for transfer.tsx and search.tsx');
