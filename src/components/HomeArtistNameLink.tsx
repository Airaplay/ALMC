import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils';

interface HomeArtistNameLinkProps {
  userId?: string | null;
  name: string;
  className?: string;
  title?: string;
}

/** Home rail artist/creator name — navigates to public profile with no link styling. */
export function HomeArtistNameLink({
  userId,
  name,
  className,
  title,
}: HomeArtistNameLinkProps) {
  if (!userId) {
    return (
      <span className={className} title={title}>
        {name}
      </span>
    );
  }

  const stopCardActivation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  return (
    <Link
      to={`/user/${userId}`}
      title={title ?? name}
      className={cn(
        'no-underline hover:no-underline active:no-underline visited:no-underline',
        'text-inherit hover:text-inherit active:text-inherit visited:text-inherit',
        'focus:outline-none focus-visible:outline-none',
        className,
      )}
      onClick={stopCardActivation}
    >
      {name}
    </Link>
  );
}
