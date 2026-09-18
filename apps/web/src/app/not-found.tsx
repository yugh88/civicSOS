import Link from 'next/link';
import { Button, EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <EmptyState
      icon="🔍"
      title="We couldn't find that page"
      description="The link may be old, or the case may belong to someone else."
      action={
        <Link href="/">
          <Button>Go to the home page</Button>
        </Link>
      }
    />
  );
}
