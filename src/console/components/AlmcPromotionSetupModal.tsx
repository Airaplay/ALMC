import {
  PromotionSetupModal,
  type PromotionSetupModalProps,
} from '../../components/PromotionSetupModal';

type AlmcPromotionSetupModalProps = Omit<PromotionSetupModalProps, 'variant'>;

export function AlmcPromotionSetupModal(props: AlmcPromotionSetupModalProps) {
  return <PromotionSetupModal {...props} variant="almc" />;
}
