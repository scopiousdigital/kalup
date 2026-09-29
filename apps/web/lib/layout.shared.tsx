import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { Logo } from '@/components/site/primitives'
import { appName, gitConfig } from './shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2.5 text-[19px] leading-none font-bold tracking-[-0.03em]">
          <Logo />
          {appName}
        </span>
      ),
    },
    // The site is light only, so the docs are too.
    themeSwitch: { enabled: false },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  }
}
