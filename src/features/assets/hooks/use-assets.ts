import { useQuery } from "@tanstack/react-query";
import { useGateways } from "../../../core/gateways/gateway-context";

export function useAssetsOverview(
  address: string | undefined,
  includePredict: boolean,
) {
  const { assets } = useGateways();
  return useQuery({
    queryKey: ["assets", address, includePredict],
    queryFn: () => assets.getOverview(address as string, { includePredict }),
    enabled: Boolean(address),
    staleTime: 15_000,
  });
}
