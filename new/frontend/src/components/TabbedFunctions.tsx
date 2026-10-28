import { Fragment, useState } from "react";

import DialPad from './DialPad';
import QuickConnects from './QuickConnects';
import RecentCallList from './RecentCallList';

// Headless UI 2.x for React, for more info and examples you can check out https://github.com/tailwindlabs/headlessui
import { Tab, TabGroup, TabList, TabPanels, TabPanel } from "@headlessui/react";

const tabs = [
    {
        name: "DialPad",
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="hi-micro hi-phone inline-block size-5"> <path fill-rule="evenodd" d="m3.855 7.286 1.067-.534a1 1 0 0 0 .542-1.046l-.44-2.858A1 1 0 0 0 4.036 2H3a1 1 0 0 0-1 1v2c0 .709.082 1.4.238 2.062a9.012 9.012 0 0 0 6.7 6.7A9.024 9.024 0 0 0 11 14h2a1 1 0 0 0 1-1v-1.036a1 1 0 0 0-.848-.988l-2.858-.44a1 1 0 0 0-1.046.542l-.534 1.067a7.52 7.52 0 0 1-4.86-4.859Z" clip-rule="evenodd"/></svg>,
    },
    {
        name: "Transfers",
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="hi-micro hi-arrow-right inline-block size-5"> <path fill-rule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clip-rule="evenodd"/></svg>,
    },
    {
        name: "Recent Calls",
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="hi-micro hi-clock inline-block size-5"> <path fill-rule="evenodd" d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8Zm7.75-4.25a.75.75 0 0 0-1.5 0V8c0 .414.336.75.75.75h3.25a.75.75 0 0 0 0-1.5h-2.5v-3.5Z" clip-rule="evenodd"/></svg>
    },
]

export default function TabbedFunctions() {
    const [activeTab, setActiveTab] = useState(0)
    const [collapsed, setCollapsed] = useState(true)
    return (
        <>
            {/* Tabs: Default with Icons */}
            <TabGroup
                selectedIndex={activeTab}
                onChange={i => {
                    setActiveTab(i);
                    setCollapsed(false)
                }}
            >
                {/* Nav Tabs */}
                <TabList className="flex items-center border-b border-secondary-200/75 text-sm">
                {
                    tabs.map(t => (
                        <Tab as={Fragment}>
                            {({ selected }) => (
                                <button
                                    type="button"
                                    className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3 font-medium md:px-5 ${
                                        selected && !collapsed
                                            ? "border-primary-500 text-primary-600"
                                            : "border-transparent text-secondary-600 hover:border-secondary-200 hover:text-primary-500"
                                    }`}
                                    onClick={() => selected && setCollapsed(c => !c)}
                                >
                                    {t.icon}
                                    <span className="hidden sm:inline-block">{t.name}</span>
                                </button>
                            )}
                        </Tab>
                    ))
                }
                </TabList>
                {/* END Nav Tabs */}

                {/* Tab Content */}
                {
                    !collapsed && (
                        <TabPanels className="py-6">
                            <TabPanel>
                                <DialPad/>
                            </TabPanel>
                            <TabPanel>
                                <QuickConnects />
                            </TabPanel>
                            <TabPanel>
                                <RecentCallList />
                            </TabPanel>
                        </TabPanels>
                    )
                }
                {/* END Tab Content */}
            </TabGroup>
            {/* END Tabs: Default with Icons */}
        </>
    );
}
