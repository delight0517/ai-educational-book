import { FaGithub, FaDiscord, FaGlobe } from 'react-icons/fa';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Link from './Link';

const SupportLinks = () => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);

  return (
    <div className='my-2 flex flex-col items-center gap-2'>
      <p className='text-neutral-content text-sm'>{_('AI Educational Book Community & Support')}</p>
      <div className='flex gap-4'>
        <Link
          href='https://github.com/delight0517/ai-educational-book'
          className='flex items-center gap-2 rounded-full bg-gray-800 p-1.5 text-white transition-colors hover:bg-gray-700'
          title='GitHub (Open Source)'
          aria-label='GitHub'
        >
          <FaGithub size={iconSize} />
        </Link>
        <Link
          href='https://discord.gg/Ks78BjAhKK'
          className='flex items-center gap-2 rounded-full bg-indigo-600 p-1.5 text-white transition-colors hover:bg-indigo-500'
          title='Discord Community'
          aria-label='Discord'
        >
          <FaDiscord size={iconSize} />
        </Link>
        <Link
          href='https://delight0517.github.io/ai-educational-book/'
          className='flex items-center gap-2 rounded-full bg-teal-600 p-1.5 text-white transition-colors hover:bg-teal-500'
          title='Official Homepage'
          aria-label='Homepage'
        >
          <FaGlobe size={iconSize} />
        </Link>
      </div>
    </div>
  );
};

export default SupportLinks;
