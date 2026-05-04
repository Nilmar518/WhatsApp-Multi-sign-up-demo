import type { ChannexProperty } from '../hooks/useChannexProperties';

interface Props {
  property: ChannexProperty;
}

export default function PropertyDetail({ property }: Props) {
  return <div className="text-sm text-gray-500">Detail for {property.title} — coming in Task 10</div>;
}
