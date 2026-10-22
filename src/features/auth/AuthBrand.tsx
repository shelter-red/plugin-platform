import { Avatar, Flex, Typography } from 'antd'
import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const { Text } = Typography

/** 登录页与控制台同源的品牌标识。 */
export function AuthBrand() {
  const { t } = useTranslation()
  return <Flex className="auth-brand" align="center" gap={10}>
    <Avatar className="auth-brand-mark" shape="square" size={30} icon={<Network size={17} strokeWidth={2.4} />} />
    <Flex vertical gap={0}>
      <Text strong className="auth-brand-name">Plugmesh</Text>
      <Text type="secondary" className="auth-brand-caption">{t('brand.caption')}</Text>
    </Flex>
  </Flex>
}
