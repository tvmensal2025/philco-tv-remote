'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AutomationSettings from '@/components/automation-settings';
import CaptureRules from '@/components/capture-rules';
import StylesManager from '@/components/styles-manager';

type Restaurant = { id: string; name: string; timezone: string; settings: Record<string, unknown> };
const tabs = ['ritmo', 'sozinho', 'prioridade'] as const;

export default function EstudioHub({
  restaurants,
  role,
  defaultTab = 'ritmo',
}: {
  restaurants: Restaurant[];
  role: string;
  defaultTab?: string;
}) {
  const tab = tabs.includes(defaultTab as (typeof tabs)[number]) ? defaultTab : 'ritmo';
  return (
    <Tabs defaultValue={tab} className="gap-6">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger value="ritmo">Ritmo</TabsTrigger>
        <TabsTrigger value="sozinho">Sozinho no turno</TabsTrigger>
        <TabsTrigger value="prioridade">O que priorizar</TabsTrigger>
      </TabsList>
      <TabsContent value="ritmo">
        <StylesManager restaurants={restaurants} role={role} />
      </TabsContent>
      <TabsContent value="sozinho">
        <AutomationSettings restaurants={restaurants} role={role} />
      </TabsContent>
      <TabsContent value="prioridade">
        <CaptureRules restaurants={restaurants} role={role} />
      </TabsContent>
    </Tabs>
  );
}
