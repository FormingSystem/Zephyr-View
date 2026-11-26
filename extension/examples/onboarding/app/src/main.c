/* SPDX-License-Identifier: Apache-2.0 */
#include <zephyr/sys/printk.h>

#ifdef CONFIG_ONBOARDING_GREETING
#include <onboarding/greeting.h>
#endif

int main(void)
{
#ifdef CONFIG_ONBOARDING_GREETING
	printk("%s\n", onboarding_greeting());
#else
	printk("Application only\n");
#endif
	return 0;
}
